var socket = null;
var socket_io = null;
function socketServer(io){
    socket_io = io;
    socket_io.on("connection", function(st) {
        socket = st;
        socket.on('message', (os) => {
            if(os === 'ping'){
                socket.emit("message", os + "pong")
            }
        })
        socket.emit("message", "pppppp")
    });
}

module.exports = { socketServer, socket, socket_io }
