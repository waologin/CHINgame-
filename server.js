const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// コネクション確認用
const connectionHealth = new Map(); // socketId -> missedPongs

setInterval(() => {
    for (const [socketId, missedPongs] of connectionHealth.entries()) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            if (missedPongs >= 3) {
                console.log(`Connection lost (3 misses): ${socketId}`);
                socket.disconnect(true);
            } else {
                connectionHealth.set(socketId, missedPongs + 1);
                socket.emit('ping-check');
            }
        } else {
            connectionHealth.delete(socketId);
        }
    }
}, 5000);

app.use(express.static(path.join(__dirname, 'public')));

// 部屋の状態を管理
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('a user connected:', socket.id);
    connectionHealth.set(socket.id, 0);

    socket.on('pong-check', () => {
        connectionHealth.set(socket.id, 0);
    });

    // 部屋作成
    socket.on('createRoom', (settings = {}) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString(); // 4桁の部屋番号
        rooms.set(roomId, {
            players: [socket.id],
            board: Array(25).fill(null),
            turn: 0, // 0: 1st player, 1: 2nd player
            symbols: ['ち', 'ん'],
            status: 'waiting', // waiting, playing, finished
            rematchVotes: new Set(),
            startingPlayer: 0, // 次回開始プレイヤー管理
            targetLength: parseInt(settings.targetLength) || 4,
            timeLimit: parseInt(settings.timeLimit) || 30,
            timer: null
        });
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        console.log(`Room created: ${roomId} with settings:`, settings);
    });

    // 部屋参加
    socket.on('joinRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            if (room.players.includes(socket.id)) return;
            if (room.players.length < 2) {
                room.players.push(socket.id);
                socket.join(roomId);
                room.status = 'playing';
                io.to(roomId).emit('gameStart', {
                    roomId,
                    players: room.players,
                    turn: room.turn,
                    targetLength: room.targetLength,
                    timeLimit: room.timeLimit
                });
                console.log(`User joined room: ${roomId}`);
                startTurnTimer(roomId);
            } else {
                socket.emit('error', 'この部屋は満員です。');
            }
        } else {
            socket.emit('error', '部屋が見つかりません。');
        }
    });

    function startTurnTimer(roomId) {
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;

        if (room.timer) clearInterval(room.timer);

        let timeLeft = room.timeLimit;
        io.to(roomId).emit('timerUpdate', timeLeft);

        room.timer = setInterval(() => {
            timeLeft--;
            io.to(roomId).emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) {
                clearInterval(room.timer);
                room.timer = null;
                // 時間切れ
                const winnerIndex = 1 - room.turn;
                const winnerId = room.players[winnerIndex];
                io.to(roomId).emit('gameEnd', {
                    board: room.board,
                    winner: winnerId,
                    reason: 'timeout'
                });
                room.status = 'finished';
            }
        }, 1000);
    }

    // 手の送信
    socket.on('makeMove', ({ roomId, index, symbol }) => {
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;

        // 手番チェック
        if (room.players[room.turn] !== socket.id) {
            return socket.emit('error', 'あなたの番ではありません。');
        }

        // マスが空いているか
        if (room.board[index] !== null) {
            return socket.emit('error', 'そのマスは既に埋まっています。');
        }

        // 不正な文字
        if (symbol !== 'ち' && symbol !== 'ん') {
            return socket.emit('error', '不正な文字です。');
        }

        // 盤面更新
        room.board[index] = symbol;
        
        // 勝敗判定
        if (checkWin(room.board, index, room.targetLength)) {
            if (room.timer) {
                clearInterval(room.timer);
                room.timer = null;
            }
            io.to(roomId).emit('gameEnd', {
                board: room.board,
                winner: socket.id,
                reason: 'win'
            });
            room.status = 'finished';
        } else if (room.board.every(cell => cell !== null)) {
            if (room.timer) {
                clearInterval(room.timer);
                room.timer = null;
            }
            io.to(roomId).emit('gameEnd', {
                board: room.board,
                winner: null,
                reason: 'draw'
            });
            room.status = 'finished';
        } else {
            // ターン交代
            room.turn = 1 - room.turn;
            io.to(roomId).emit('updateBoard', {
                board: room.board,
                turn: room.turn
            });
            startTurnTimer(roomId);
        }
    });

    // 再戦リクエスト
    socket.on('requestRematch', (roomId) => {
        const room = rooms.get(roomId);
        if (!room || room.status !== 'finished') return;

        room.rematchVotes.add(socket.id);
        
        if (room.rematchVotes.size === 2) {
            // 2人とも再戦希望ならリセット
            room.board = Array(25).fill(null);
            room.rematchVotes.clear();
            room.status = 'playing';
            
            room.startingPlayer = 1 - room.startingPlayer;
            room.turn = room.startingPlayer;
            
            io.to(roomId).emit('gameStart', {
                roomId,
                players: room.players,
                turn: room.turn,
                targetLength: room.targetLength,
                timeLimit: room.timeLimit
            });
            startTurnTimer(roomId);
        } else {
            socket.to(roomId).emit('rematchRequested');
        }
    });

    // 終了してロビーへ
    socket.on('quitGame', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            if (room.timer) clearInterval(room.timer);
            io.to(roomId).emit('playerQuit');
            rooms.delete(roomId);
        }
    });

    socket.on('disconnect', () => {
        console.log('user disconnected:', socket.id);
        connectionHealth.delete(socket.id);
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                if (room.timer) clearInterval(room.timer);
                io.to(roomId).emit('playerDisconnected');
                rooms.delete(roomId);
            }
        }
    });
});

function checkWin(board, lastIndex, targetLength) {
    const size = 5;
    const baseTarget = ['ち', 'ん'];
    const target = [];
    for (let i = 0; i < targetLength; i++) {
        target.push(baseTarget[i % 2]);
    }

    const directions = [
        [1, 0], [0, 1], [1, 1], [-1, 1]
    ];

    for (const [dx, dy] of directions) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (checkLine(board, x, y, dx, dy, target)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function checkLine(board, x, y, dx, dy, target) {
    const size = 5;
    for (let i = 0; i < target.length; i++) {
        const nx = x + i * dx;
        const ny = y + i * dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) return false;
        if (board[ny * size + nx] !== target[i]) return false;
    }
    return true;
}

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
