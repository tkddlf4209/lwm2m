
const EventEmitter = require('events');
const WebSocket = require('ws');
var WebSocketServer = WebSocket.Server;

const RESPONSE_TIMEOUT_LIMIT = 3000; // 응답 제한 시간
var callbackUuids = {};// 주기적으로 응답이 없는 콜백을 제거한다.
function startWebServer(port, event) {

    var wss = new WebSocketServer({ port: port });
    wss.on('connection', function connection(client, req) {

        var device_type = req.headers.device_type;
        var uuid = req.headers.uuid;

        if (!device_type || !uuid) { // 연결 시 헤더에 장치타입(device_type)값이 없을 경우 연결을 강제종료
            console.log('device_type or uuid not defined!!');
            client.close();
            return;
        } else {
            client.socket_id = uuid; // 고유 uuid
            client.device_type = device_type; // 장치 타입 
            event.emit('socket_connect', client) // 연결 Client 정보 전달

            client.on('message', (message) => {
                try {
                    var response = JSON.parse(message);

                    if (response.uuid && callbackUuids[response.uuid]) { // 응답 callback 
                        callbackUuids[response.uuid].resolve(response);
                        delete callbackUuids[response.uuid];
                    } else {
                        event.emit('message', client, response)
                    }

                } catch (e) {
                    if (response.uuid && callbackUuids[response.uuid]) {
                        callbackUuids[response.uuid].reject(new Error("Resposne JSON Parse Error"));
                        delete callbackUuids[response.uuid];
                    } else {
                        console.log('error message : ', e);
                    }
                }
            });

            client.on('close', () => {
                event.emit('socket_close', client)
            });

        }
    });

    checkResponseTimeout();
    return wss;
}

function checkResponseTimeout() {
    var now = new Date().getTime();

    // 일정 시간 응답이 없는 Callback 제거
    Object.keys(callbackUuids).forEach(uuid => {
        if (now - callbackUuids[uuid].timestamp > RESPONSE_TIMEOUT_LIMIT) {
            callbackUuids[uuid].reject(new Error("Request is failed : Timeout"));
            delete callbackUuids[uuid];
        }
    })

    setTimeout(function () {
        checkResponseTimeout();
    }, RESPONSE_TIMEOUT_LIMIT);
}


class ConnectionManger extends EventEmitter {
    // Add any custom methods here
    constructor(port) {
        super();
        this.wss = startWebServer(port, this);
    }

    send(client, message) {
        return new Promise(function (resolve, reject) {
            if (message.confirm) { // 응답 값이 필요한 경우.
                callbackUuids[message.uuid] = {
                    resolve: resolve,
                    reject: reject,
                    timestamp: new Date().getTime()
                };
            }
            client.send(JSON.stringify(message)); // 메세지 전송
        });
    }

}
module.exports = ConnectionManger


// function sendAll(message) {
//     //console.log(wss.clients.size);
//     wss.clients.forEach(function each(client) {
//         if (client.readyState === WebSocket.OPEN) {
//             client.send(message);
//         }
//     });
// }