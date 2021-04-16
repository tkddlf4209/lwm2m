
var DeviceManager = require("./manage/device_manager");
var ConnectionManger = require("./manage/connection_manager");


const PORT = process.env.PORT || 3000; // 웹 소켓 서버 포트
var cm = new ConnectionManger(PORT);
var rm = new DeviceManager(cm);
