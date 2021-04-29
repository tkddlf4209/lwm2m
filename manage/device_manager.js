const { v4: uuidv4 } = require('uuid');
const util = require('util')
var moment = require('moment');
const { log } = require('console');
const e = require('cors');
require('moment-timezone');
moment.tz.setDefault("Asia/Seoul")

// REQ TYPE (AGENT <-> OCF Client, IoTWare Server)
const DEVICE_LIST_REQ = "DEVICE_LIST_REQ"
const DEVICE_LIST_RSP = "DEVICE_LIST_RSP"
const OBJECT_GET_REQ = "OBJECT_GET_REQ"
const OBJECT_GET_RSP = "OBJECT_GET_RSP"
const OBJECT_UPDATE_REQ = "OBJECT_UPDATE_REQ"
const OBJECT_UPDATE_RSP = "OBJECT_UPDATE_RSP"
const DEVICE_REMOVED_NOTIFY = "DEVICE_REMOVED"
const DEVICE_ADD_NOTIFY = "DEVICE_ADD"

// REQ TYPE (LWM2M Client <-> AGENT)
const OBJECT_LIST = "OBJECT_LIST" // 최초 연결 시 / DC 활성,비활성화시 전체 OBJECT LIST 전송
const OBJECT_ADD = "OBJECT_ADD"  // 새로운 장치 연결로 인한 OBJECT 추가
const OBJECT_DELETE = "OBJECT_DELETE" // 장치 연결 끊김으로 인한 OBJECT 삭제
const OBJECT_UPDATE = "OBJECT_UPDATE" // 장치 연결 끊김으로 인한 OBJECT 삭제

// DEVICE_TYPE
const IOTWARE_SERVER = 'IOTWARE_SERVER';
const LWM2M_CLIENT = 'LWM2M_CLIENT';
const OCF_CLIENT = 'OCF_CLIENT';
const AGENT_UI = 'AGENT_UI';
const FALLING_INTERVAL = 3000;

var connection_manager;

var iotware_socket = {
    devices: {},
    client: null
}

var ocf_client_socket = {
    devices: {},
    client: null
}

var lwm2m_client_socket = {
    devices: {},
    client: null
}

var objects_bucket = {};
var dc_enable = true;

function addObject(object) {
    object.add_time = now();
    object.update_time = now();

    if (!objects_bucket[object.object_id] || (objects_bucket[object.object_id] && objects_bucket[object.object_id].length == 0)) { // init   // object를 처음 추가하는 경우.
        objects_bucket[object.object_id] = [object];
    } else {
        objects_bucket[object.object_id].push(object)
    }
}

//dc_resource 는 3303,3304 등 object_id 별로 [] 형태로 object를 관리한다.
function removeObject(body, device_type) {
    Object.keys(objects_bucket).forEach(object_id => {
        objects_bucket[object_id] = objects_bucket[object_id].filter(function (object) { // 조건에 맞지 않는(!) object 유지, 조건에 맞는 경우에는 object 삭제
            if (body == null) { // (IoT Ware server 서버 소켓 연결이 끊김)
                console.log('#############1', object);
                if (object.device_type == device_type) {
                    if (lwm2m_client_socket.client) {
                        connection_manager.send(lwm2m_client_socket.client, message(OBJECT_DELETE, {
                            device_id: object.device_id,
                            device_type: object.device_type,
                            object_id: object.object_id
                        }));
                    }
                }

                return !(object.device_type == device_type) // device_type: IotWareServer , OCFClient..
            } else {
                console.log('#############2', object);

                if (object.device_id == body.device_id) {
                    if (lwm2m_client_socket.client) {
                        connection_manager.send(lwm2m_client_socket.client, message(OBJECT_DELETE, {
                            device_id: object.device_id,
                            device_type: object.device_type,
                            object_id: object.object_id
                        }));
                    }
                }

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
        if (dc_enable) {
            Object.keys(objects_bucket).forEach(object_id => {
                var objects = objects_bucket[object_id];
                var obj = objects[0];

                var client;
                if (obj) {
                    // device_type에 따른 연결 소켓 가져오기
                    switch (obj.device_type) {
                        case IOTWARE_SERVER:
                            client = iotware_socket.client;
                            break;
                        case OCF_CLIENT:
                            client = ocf_client_socket.client;
                            break;
                    }
                }

                if (client) { // 첫번째 object에게 값을 요청
                    cm.send(client, message(OBJECT_GET_REQ, {
                        device_id: obj.device_id,
                        object_id: object_id,
                    }, true)).then(function (data) {
                        iotware_server_msg_parse(client, data);
                    }).catch(function (err) {
                        console.log(err);
                    });
                }
            })
        } else {
            // 모든 리소스에 요청
            Object.keys(objects_bucket).forEach(object_id => {
                var objects = objects_bucket[object_id];
                objects.forEach(obj => {
                    var client;
                    if (obj) {
                        switch (obj.device_type) {
                            case IOTWARE_SERVER:
                                client = iotware_socket.client;
                                break;
                            case OCF_CLIENT:
                                client = ocf_client_socket.client;
                                break;
                        }
                    }

                    if (client) { // 첫번째 object에게 값을 요청
                        cm.send(client, message(OBJECT_GET_REQ, {
                            device_id: obj.device_id,
                            object_id: object_id,
                        }, true)).then(function (data) {
                            iotware_server_msg_parse(client, data);
                        }).catch(function (err) {
                            console.log(err);
                        });
                    }
                })


            })
        }


        console.log('!!!!', objects_bucket);

        // if (dc_objects['3303']) {
        //     dc_objects['3303'].forEach(obj => {
        //         console.log(obj.device_id, obj.resources);
        //     })
        // }
    }, FALLING_INTERVAL);


    // 소켓 관련
    cm.on('socket_connect', function (client) { // 신규 Client 연결됨
        console.log('Socket connected ==> device_type : ', client.device_type);
        switch (client.device_type) {
            case IOTWARE_SERVER:
                iotware_socket.client = client;
                cm.send(client, message(DEVICE_LIST_REQ, null, true)).then(function (data) {
                    iotware_server_msg_parse(client, data);
                }).catch(function (err) {
                    console.log(err);
                });

                break;
            case LWM2M_CLIENT:
                lwm2m_client_socket.client = client;

                cm.send(client, message(OBJECT_LIST, {
                    objects: objects_bucket,
                    dc_enable: dc_enable
                }));

                break;
        }

    })

    cm.on('socket_close', function (client) {
        //console.log('close socket test@@@', client.socket_id, 'socket_devices : ', socket_devices, 'dc_resources : ', dc_resource);

        // 소켓 관리 제거
        switch (client.device_type) {
            case IOTWARE_SERVER:
                iotware_socket.client = null;
                dc_operate(null, null, IOTWARE_SERVER);
                break;
            case LWM2M_CLIENT:
                lwm2m_client_socket.client = null;
                break;
        }

        //delete socket_devices[client.socket_id];
    });

    // 메세지 관련 : 장치연결, 장치제거, exec or write 응답
    cm.on('message', function (client, data) {
        //console.log(data);

        switch (client.device_type) {
            case IOTWARE_SERVER:
                iotware_server_msg_parse(client, data);
                break;
            case LWM2M_CLIENT:
                lwm2m_client_msg_parse(client, data)
                break;
        }

    })
}

function lwm2m_client_msg_parse(client, data) {

    // object_update
    var deivce_id = data.device_id;
    var object_id = data.object_id;
    var item_id = data.item_id;
    var value = data.value;

    if (data.device_type == IOTWARE_SERVER) {
        if (iotware_socket.client) {

            connection_manager.send(iotware_socket.client, message(OBJECT_UPDATE_REQ, {
                device_id: deivce_id,
                object_id: object_id,
                item_id: item_id,
                value: value
            }, true)).then(function (data) {
                iotware_server_msg_parse(iotware_socket.client, data);
            }).catch(function (err) {
                console.log(err);
            });

        }
    } else {
        if (ocf_client_socket.client) {
            connection_manager.send(ocf_client_socket.client, message(OBJECT_UPDATE_REQ, {
                device_id: deivce_id,
                object_id: object_id,
                item_id: item_id,
                value: value
            }, true)).then(function (data) {
                iotware_server_msg_parse(ocf_client_socket.client, data);
            }).catch(function (err) {
                console.log(err);
            });

        }
    }


}

function iotware_server_msg_parse(client, data) {
    var body = data.body;

    // AGENT UI에서 연결된 소켓의 모든 리소스 관리
    switch (data.msg_type) {
        case DEVICE_LIST_RSP:
            iotware_socket.devices = body
            break;
        case DEVICE_ADD_NOTIFY:
            iotware_socket.devices[body.device_id] = body
            break;
        case DEVICE_REMOVED_NOTIFY:
            iotware_socket.devices[body.device_id].connect = false;
            break;
        case OBJECT_UPDATE_RSP:
        case OBJECT_GET_RSP:
            if (body.result && body.object) {
                var object_id = body.object_id;
                var device_id = body.device_id;

                //console.log(object_id, device_id, socket_id);
                if (iotware_socket.devices[device_id].objects[object_id] && body.result) {
                    iotware_socket.devices[device_id].objects[object_id] = body.object; // 값 갱신
                }
                //console.log(data.msg_type, socket_devices[socket_id].devices[device_id].objects[object_id]);
            }

            break;


    }

    // DC Resource 관리 
    dc_operate(client, data, IOTWARE_SERVER);


}

function dc_operate(client, data, device_type) {

    if (client == null) { // 소켓 연결이 끊겼을 때 관련 장치타입 (IoTWare or OCF Client)의 DC 리소스를 모두 제거한다.

        removeObject(null, device_type)

        if (lwm2m_client_socket.client) { //lWM2M Client에게 디바이스 리스트를 개신하도록 한다.
            connection_manager.send(lwm2m_client_socket.client, message(OBJECT_LIST, {
                objects: objects_bucket
            }));
        }

    } else {
        var body = data.body;
        switch (data.msg_type) {
            case OBJECT_UPDATE_RSP:
            case OBJECT_GET_RSP:
                if (body.result && body.object) {

                    var i = 0;
                    objects_bucket[body.object.object_id].forEach(dc_object => {
                        if (dc_object && dc_object.device_id == body.device_id) {
                            var old_object = objects_bucket[body.object.object_id][i];
                            var new_object = body.object;
                            new_object.device_type = client.device_type;
                            new_object.device_id = body.device_id;
                            new_object.add_time = old_object.add_time;
                            new_object.update_time = now();
                            objects_bucket[body.object.object_id][i] = new_object // 새로운 object로 갱신.

                            // 데이터 갱신 알림
                            if (lwm2m_client_socket.client) {
                                connection_manager.send(lwm2m_client_socket.client, message(OBJECT_UPDATE, {
                                    object: new_object
                                }));
                            }

                        }
                        i++;
                    })
                    //console.log(dc_resource);
                }
                break;
            case DEVICE_LIST_RSP:
                Object.keys(body).forEach(device_id => {

                    Object.keys(body[device_id].objects).forEach(object_id => {
                        var object = body[device_id].objects[object_id];
                        object.device_type = client.device_type;
                        object.device_id = device_id;
                        addObject(object);

                        if (lwm2m_client_socket.client) {
                            //console.log('######', JSON.stringify(object));
                            connection_manager.send(lwm2m_client_socket.client, message(OBJECT_ADD, {
                                object: object
                            }));
                        }
                    })
                })

                break;
            case DEVICE_ADD_NOTIFY:
                // 신규 추가장치의 object를 저장
                Object.keys(body.objects).forEach(object_id => {
                    var object = body.objects[object_id];
                    object.device_type = client.device_type;
                    object.device_id = body.device_id;
                    addObject(object);

                    if (lwm2m_client_socket.client) {
                        connection_manager.send(lwm2m_client_socket.client, message(OBJECT_ADD, {
                            object: object
                        }));
                    }
                })

                break;
            case DEVICE_REMOVED_NOTIFY:
                // 장치가 제거되었을 경우 해당 장치의 object도 dc 리소스에서 제거한다.
                removeObject(body, device_type)
                break;
        }
    }



    // 우선순위 알고리즘으로 인한 정렬 기능 추가해야됨
    //console.log(dc_resource);
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

var i = 0;
function now() {
    return Date.now() + (i++); // 겹치는 시간이 없게하기 위해
}

module.exports = DeviceManager
