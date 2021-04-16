const { v4: uuidv4 } = require('uuid');
const util = require('util')
var moment = require('moment');
const { log } = require('console');
require('moment-timezone');
moment.tz.setDefault("Asia/Seoul")


// REQ TYPE
const DEVICE_LIST_REQ = "DEVICE_LIST_REQ"
const DEVICE_LIST_RSP = "DEVICE_LIST_RSP"
const OBJECT_GET_REQ = "OBJECT_GET_REQ"
const OBJECT_GET_RSP = "OBJECT_GET_RSP"
const OBJECT_UPDATE_REQ = "OBJECT_UPDATE_REQ"
const OBJECT_UPDATE_RSP = "OBJECT_UPDATE_RSP"

const DEVICE_REMOVED_NOTIFY = "DEVICE_REMOVED"
const DEVICE_ADD_NOTIFY = "DEVICE_ADD"
const OBJECT_ADD_NOTIFY = "OBJECT_ADD"
const OBJECT_REMOVED_NOTIFY = "OBJECT_REMOVED"

// DEVICE_TYPE
const IOT_WARE_SERVER = 'IOT_WARE_SERVER';
const LWM2M_CLIENT = 'LWM2M_CLIENT';
const OCF_CLIENT = 'OCF_CLIENT';

var connection_manager;
var socket_devices = {};
var dc_resource = {};


function dc_operate(client, data, disconnect_socket_id) {

    if (disconnect_socket_id) { // 소켓 연결이 끊겼을 때 관련 소켓의 DC 리소스를 모두 제거한다.
        removeObject(null, null, disconnect_socket_id)
    } else {
        var body = data.body;
        switch (data.msg_type) {
            case OBJECT_UPDATE_RSP:
            case OBJECT_GET_RSP:
                if (body.result && body.object) {
                    var i = 0;
                    dc_resource[body.object.object_id].forEach(dc_object => {
                        if (dc_object && dc_object.socket_id == client.socket_id && dc_object.device_id == body.device_id) {
                            var object = body.object;
                            object.client = client;
                            object.socket_id = client.socket_id;
                            object.device_type = client.device_type;
                            object.device_id = body.device_id;
                            dc_resource[body.object.object_id][i] = object // 새로운 object로 갱신.
                            i++;
                        }
                    })

                    //console.log(dc_resource);
                }

                break;
            case DEVICE_LIST_RSP:
                Object.keys(body).forEach(device_id => {
                    Object.keys(body[device_id].objects).forEach(object_id => {
                        var object = body[device_id].objects[object_id];
                        object.client = client;
                        object.socket_id = client.socket_id;
                        object.device_type = client.device_type;
                        object.device_id = device_id;
                        addObject(object);
                    })
                })

                break;
            case DEVICE_ADD_NOTIFY:
                // 신규 추가장치의 object를 저장
                Object.keys(body.objects).forEach(object_id => {
                    var object = body[body.device_id].objects[object_id];
                    object.client = client;
                    object.socket_id = client.socket_id;
                    object.device_type = client.device_type;
                    object.device_id = body.device_id;
                    addObject(object);
                })

                break;
            case DEVICE_REMOVED_NOTIFY:
                // 장치가 제거되었을 경우 해당 장치의 object도 dc 리소스에서 제거한다.
                removeObject(null, body)
                break;
            case OBJECT_ADD_NOTIFY:
                // object가 추가되었을 경우 
                var object = body.object;
                object.client = client;
                addObject(object); // socket_id, device_type, deivce_id 정보가 담겨서 object가 넘어옴
                break;
            case OBJECT_REMOVED_NOTIFY:
                removeObject(client.socket_id, body)
                break;
        }

    }


    // 우선순위 알고리즘으로 인한 정렬 기능 추가해야됨
    //console.log(dc_resource);
}

function addObject(object) {
    if (!dc_resource[object.object_id] || (dc_resource[object.object_id] && dc_resource[object.object_id].length == 0)) { // init   // object를 처음 추가하는 경우.
        dc_resource[object.object_id] = [object];

        var client = object ? object.client : null;

        if (client) {
            // 5850 item_id check...
            // .............

            connection_manager.send(client, message(OBJECT_UPDATE_REQ, {
                device_id: object.device_id,
                object_id: object.object_id,
                item_id: 5850,
                value: true
            }, true)).then(function (data) {
                message_parse(client, data);
            }).catch(function (err) {
                console.log(err);
            });

        }
    } else {
        dc_resource[object.object_id].push(object)
    }
}

//dc_resource 는 3303,3304 등 object_id 별로 [] 형태로 object를 관리한다.
function removeObject(socket_id, body, disconnect_socket_id) {
    Object.keys(dc_resource).forEach(object_id => {
        dc_resource[object_id] = dc_resource[object_id].filter(function (object) { // 조건에 맞지 않는(!) object 유지, 조건에 맞는 경우에는 object 삭제

            if (disconnect_socket_id) { // (IoT Ware server 서버 소켓 연결이 끊김)
                return !(object.socket_id == disconnect_socket_id)
            } else if (socket_id) {
                // Object가 제거되었을 경우, 해당 소켓(socket_id)에 연결된 장치(devic_id)의 object(object_id)를 제거한다.
                return !(object.device_id == body.device_id && object.socket_id == socket_id && object.object_id == body.object_id)
            } else {
                // 장치가 제거되었을 경우 (IoT Ware Server 하위 Device 연결이 끊김 (소켓 연견이 끊긴건 아님))
                return !(object.device_id == body.device_id)
            }
        })
    });

}

function DeviceManager(cm) {
    connection_manager = cm;
    // 3초마다 dc 리소스의 값을 요청
    setInterval(function () {
        Object.keys(dc_resource).forEach(object_id => {

            var objects = dc_resource[object_id];
            var obj = objects[0];
            var client = obj ? obj.client : null;

            if (obj && client) { // 첫번째 object에게 값을 요청
                cm.send(client, message(OBJECT_GET_REQ, {
                    device_id: obj.device_id,
                    object_id: object_id,
                }, true)).then(function (data) {
                    message_parse(client, data);
                }).catch(function (err) {
                    console.log(err);
                });

            }

        })
        //console.log(dc_resource);
    }, 3000);


    // 소켓 관련
    cm.on('socket_connect', function (client) { // 신규 Client 연결됨
        console.log('Socket connected ==> device_type : ', client.device_type, ' / uuid : ', client.socket_id);

        if (client.device_type != IOT_WARE_SERVER && client.device_type != OCF_CLIENT) {
            return;
        }

        cm.send(client, message(DEVICE_LIST_REQ, null, true)).then(function (data) {
            message_parse(client, data);
        }).catch(function (err) {
            console.log(err);
        });

    })

    cm.on('socket_close', function (client) {
        //console.log('close socket test@@@', client.socket_id, 'socket_devices : ', socket_devices, 'dc_resources : ', dc_resource);

        // 소켓 관리 제거
        delete socket_devices[client.socket_id];
        // DC 리소스 제거
        dc_operate(null, null, client.socket_id);

        console.log('close socket#', client.socket_id, 'socket_devices : ', Object.keys(socket_devices).length, 'dc_resources : ', dc_resource);
    });


    // 메세지 관련 : 장치연결, 장치제거, exec or write 응답
    cm.on('message', function (client, data) {
        //console.log('notify', data);
        message_parse(client, data);
    })
}

function message_parse(client, data) {
    var body = data.body;

    if (client.device_type == IOT_WARE_SERVER || client.device_type == OCF_CLIENT) {

        // AGENT UI에서 연결된 소켓의 모든 리소스 관리
        switch (data.msg_type) {
            case OBJECT_UPDATE_RSP:
            case OBJECT_GET_RSP:
                if (body.result && body.object) {
                    var object_id = body.object_id;
                    var device_id = body.device_id;
                    var socket_id = client.socket_id;

                    //console.log(object_id, device_id, socket_id);
                    if (socket_devices[socket_id].devices[device_id].objects[object_id] && body.result) {
                        socket_devices[socket_id].devices[device_id].objects[object_id] = body.object; // 값 갱신
                    }
                    //console.log(data.msg_type, socket_devices[socket_id].devices[device_id].objects[object_id]);
                }


                break;
            case DEVICE_LIST_RSP:
                socket_devices[client.socket_id] = {
                    devices: body,
                    device_type: client.device_type
                }
                break;
            case DEVICE_ADD_NOTIFY:
                socket_devices[client.socket_id].devices[body.device_id] = body
                break;
            case DEVICE_REMOVED_NOTIFY:
                delete socket_devices[client.socket_id].devices[body.device_id]
                break;
            case OBJECT_ADD_NOTIFY:
                socket_devices[client.socket_id].devices[body.object.device_id].objects[body.object.object_id] = body.object
                break;
            case OBJECT_REMOVED_NOTIFY:
                delete socket_devices[client.socket_id].devices[body.device_id].objects[body.object_id]
                break;

        }

        // DC Resource 관리 
        dc_operate(client, data);
    } else {
        // LWM2M Client 메세지
    }



}

function message(msg_type, body, confirm) {
    return {
        uuid: uuidv4(),
        msg_type: msg_type,
        body: body,
        confirm: confirm ? confirm : false
    }
};


function showJsonDepthAll(obj) {
    console.log(util.inspect(obj, false, null, true /* enable colors */))
}

module.exports = DeviceManager
