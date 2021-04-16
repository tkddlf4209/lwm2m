const DEVICE_LWM2M_CLIENT = 'LWM2M_CLIENT';
const DEVICE_OCF_CLIENT = 'OCF_CLIENT';
const DEVICE_IOT_WARE_SERVER = 'IOT_WARE_SERVER';
const { v4: uuidv4 } = require('uuid');
const util = require('util')
const CLIENT_UUID = uuidv4();
const DEVICE_TYPE = DEVICE_IOT_WARE_SERVER
const WEBSOCKET_SERVER_ADDRESS = 'ws://localhost:3000'


// REQ TYPE
const DEVICE_LIST_REQ = "DEVICE_LIST_REQ"
const DEVICE_LIST_RSP = "DEVICE_LIST_RSP"
const OBJECT_GET_REQ = "OBJECT_GET_REQ"
const OBJECT_GET_RSP = "OBJECT_GET_RSP"
const OBJECT_UPDATE_REQ = "OBJECT_UPDATE_REQ"
const OBJECT_UPDATE_RSP = "OBJECT_UPDATE_RSP"

const DEVICE_ADD_NOTIFY = "DEVICE_ADD"
const DEVICE_REMOVED_NOTIFY = "DEVICE_REMOVED"
const OBJECT_ADD_NOTIFY = "OBJECT_ADD"
const OBJECT_REMOVED_NOTIFY = "OBJECT_REMOVED"

var WebSocket = require('ws');
var reconnectInterval = 5000;
var ws;
var devices = {
    '1': {
        device_id: '1',
        objects: {
            '3303': {
                object_id: '3303',
                name: 'temperature',
                resources: [
                    {
                        item_id: 5700,
                        name: 'Sensor Value',
                        operation: 'R',
                        type: 'Float',
                        value: '49.3728'
                    },
                    {
                        item_id: 5850,
                        name: 'On/Off',
                        operation: 'RW',
                        type: 'Boolean',
                        value: 'false'
                    }
                ]
            }
        }
    }
}

var connect = function () {

    console.log('CLINET INFO =>', DEVICE_TYPE, ',', CLIENT_UUID); // 해당 Client의 고유 랜덤 UUID 

    ws = new WebSocket(WEBSOCKET_SERVER_ADDRESS, {
        headers: {
            device_type: DEVICE_TYPE,
            uuid: CLIENT_UUID
        }
    });
    ws.on('open', function () {
        console.log('socket open');
    });

    ws.on('error', function () {
        console.log('socket error');
    });

    ws.on('message', function (data) {
        try {
            //console.log(data);
            var req = JSON.parse(data);
            var confirm = req.confirm;
            if (req.msg_type) {
                switch (req.msg_type) {
                    case DEVICE_LIST_REQ:
                        ws.send(JSON.stringify({
                            uuid: req.uuid,
                            msg_type: DEVICE_LIST_RSP,
                            body: devices
                        }))
                        break;
                    case OBJECT_GET_REQ:
                        var object = null;
                        var deivce_id = req.body.device_id;
                        var object_id = req.body.object_id;

                        if (devices[deivce_id] && devices[deivce_id].objects[object_id]) {
                            object = devices[deivce_id].objects[object_id];
                        }

                        if (object) {
                            ws.send(JSON.stringify({
                                uuid: req.uuid,
                                msg_type: OBJECT_GET_RSP,
                                body: {
                                    object: object,
                                    object_id: object_id,
                                    device_id: deivce_id,
                                    result: true
                                }
                            }))
                        } else {
                            ws.send(JSON.stringify({
                                uuid: req.uuid,
                                msg_type: OBJECT_GET_RSP,
                                body: {
                                    result: false
                                }
                            }))
                        }
                        break;
                    case OBJECT_UPDATE_REQ:
                        var deivce_id = req.body.device_id;
                        var object_id = req.body.object_id;
                        var item_id = req.body.item_id;
                        var value = req.body.value;

                        if (devices[req.body.device_id] && devices[req.body.device_id].objects[req.body.object_id]) {
                            devices[req.body.device_id].objects[req.body.object_id].resources = devices[req.body.device_id].objects[req.body.object_id].resources.map(item => {
                                if (item.item_id == item_id) {
                                    item.value = value;
                                }
                                return item;
                            })

                            ws.send(JSON.stringify({
                                uuid: req.uuid,
                                msg_type: OBJECT_UPDATE_RSP,
                                body: {
                                    object: devices[req.body.device_id].objects[req.body.object_id],
                                    object_id: object_id,
                                    device_id: deivce_id,
                                    result: true
                                }
                            }))
                        } else {
                            ws.send(JSON.stringify({
                                uuid: req.uuid,
                                msg_type: OBJECT_UPDATE_RSP,
                                body: {
                                    result: false
                                }
                            }))
                        }


                        break;
                }
            } else {
                console.log('msg_type is empty');
            }

        } catch (e) {

        }

    });

    ws.on('close', function () {
        console.log('socket close');
        setTimeout(connect, reconnectInterval);
    });
};
connect();

function addObj(device_id, object_id) {

    var name;
    var value;

    if (object_id == 3303) {
        name = "temperature"
        value = (Math.random() * (38.000 - 24.0000) + 38.0000).toFixed(4);
    } else {
        name = "humidity"
        value = (Math.random() * (100.000 - 0.0000) + 0.0000).toFixed(4);
    }

    Object.keys(devices).forEach(key => {

        if (key == device_id) {
            var object = {
                object_id: object_id,
                name: name,
                resources: [
                    {
                        item_id: 5700, // lwm2m 연동 item ID 
                        name: 'Sensor Value', // Agent Resource UI name
                        operation: 'R',  // excute(E), Read(R), Write(W)  
                        type: "Float", // value type
                        value: value
                    },
                    {
                        item_id: 5850,
                        name: 'On/Off',
                        operation: 'RW',
                        type: 'Boolean',
                        value: 'false'
                    }
                ]
            }

            devices[device_id].objects[object_id] = object;

            console.log(object);

            object.socket_id = CLIENT_UUID;
            object.device_type = DEVICE_TYPE;
            object.device_id = device_id;

            ws.send(JSON.stringify({
                msg_type: OBJECT_ADD_NOTIFY,
                body: {
                    object: object
                }
            }))
        }


    })

}


function removeObj(device_id, object_id) {

    Object.keys(devices).forEach(key => {

        if (key == device_id) {
            if (devices[device_id].objects[object_id]) {
                ws.send(JSON.stringify({
                    msg_type: OBJECT_REMOVED_NOTIFY,
                    body: {
                        device_id: device_id,
                        object_id: object_id
                    }
                }))
                delete devices[device_id].objects[object_id]
            } else {
                console.log('obj is undefined');
            }
        }

    })

}


function updateObj(device_id, object_id, item_id, value) {
    console.log(device_id, object_id, item_id, value);
    Object.keys(devices).forEach(key => {
        if (key == device_id && devices[device_id].objects[object_id]) {
            devices[device_id].objects[object_id].resources.forEach(item => {
                if (item.item_id == item_id) {
                    item.value = value;

                    //console.log(devices[device_id].objects[object_id].resources);

                    ws.send(JSON.stringify({
                        msg_type: OBJECT_UPDATE_RSP,
                        body: {
                            object: devices[device_id].objects[object_id],
                            object_id: object_id,
                            device_id: device_id,
                            result: true
                        }
                    }))
                }
            })







        }

    })

}

function checkDeviceExist(device_id) {
    return devices[device_id] == undefined ? false : true;
}

function addDevice(device_id) {
    var data = {
        device_id: device_id,
        objects: {}
    };

    devices[device_id] = data

    ws.send(JSON.stringify({
        msg_type: DEVICE_ADD_NOTIFY,
        body: data
    }))
}

const readline = require("readline");
const e = require('cors');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function help() {
    console.log('===============================================================');
    console.log('1. list : 장치 리스트 보기');
    console.log('2. delete device {device_id} : id에 해당하는 디바이스 제거 ');
    console.log('3. add device {device_id} : id에 해당하는 디바이스 추가');
    console.log('4. add object {device_id} {object_id} : 디바이스에 object 추가');
    console.log('4. remove object {device_id} {object_id} : 디바이스 object 제거');
    console.log('4. update item {device_id} {object_id} {item_id} {value}: object 값 변경');
    console.log('===============================================================');
}

help();
rl.on("line", function (line) {
    if (line.includes("list")) {
        showJsonDepthAll(devices)
    } else if (line.includes("delete device")) {
        var device_id = line.split(' ')[2];

        if (!device_id) {
            console.log('device_id undefined');
        } else {
            if (devices[device_id]) {
                ws.send(JSON.stringify({
                    msg_type: DEVICE_REMOVED_NOTIFY,
                    body: devices[device_id]
                }))
                delete devices[device_id]
            } else {
                console.log('DEVICE ID ', device_id, 'is NULL');
            }

        }
        //console.log('delete device ', );
    } else if (line.includes("add device")) {
        var device_id = line.split(' ')[2];
        if (!device_id) {
            console.log('device_id undefined');
        } else {
            if (!checkDeviceExist(device_id)) {
                addDevice(device_id)
            } else {
                console.log('device already exist device_id : ', device_id);
            }

        }
    } else if (line.includes("add object")) {
        var device_id = line.split(' ')[2];
        var object_id = line.split(' ')[3];
        if (!device_id) {
            console.log('device_id undefined');
        }

        if (!object_id) {
            console.log('object_id undefined');
        }

        addObj(device_id, object_id)

    } else if (line.includes("remove object")) {
        var device_id = line.split(' ')[2];
        var object_id = line.split(' ')[3];

        if (!device_id) {
            console.log('device_id undefined');
        }

        if (!object_id) {
            console.log('object_id undefined');
        }

        removeObj(device_id, object_id)
    } else if (line.includes("update item ")) {
        var device_id = line.split(' ')[2];
        var object_id = line.split(' ')[3];
        var item_id = line.split(' ')[4];
        var value = line.split(' ')[5];

        if (!device_id) {
            console.log('device_id undefined');
        }

        if (!object_id) {
            console.log('object_id undefined');
        }

        if (!item_id) {
            console.log('item_id undefined');
        }

        if (!value) {
            console.log('value undefined');
        }

        updateObj(device_id, object_id, item_id, value)
    }
    help();
    //rl.close();
}).on("close", function () {
    process.exit();
});

function showJsonDepthAll(obj) {
    console.log(util.inspect(obj, false, null, true /* enable colors */))
}

