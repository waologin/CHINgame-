const socket = io();

// コネクション確認
socket.on('ping-check', () => {
    socket.emit('pong-check');
});

let gameMode = null; // 'local' or 'online'
let currentRoomId = null;
let mySymbol = 'ち';
let isMyTurn = false;
let myPlayerIndex = -1;

// Local Mode State
let localBoard = Array(25).fill(null);
let localTurn = 0; // 0 or 1
let localStartingPlayer = 0;

// 設定
let targetLength = 4;
let timeLimit = 30;
let timerId = null;

const modeSelectionDiv = document.getElementById('mode-selection');
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');
const roomIdInput = document.getElementById('room-id');
const displayRoomId = document.getElementById('display-room-id');
const statusDiv = document.getElementById('status');
const boardDiv = document.getElementById('board');
const controlsDiv = document.getElementById('controls');
const symbolBtns = document.querySelectorAll('.symbol-btn');
const postGameDiv = document.getElementById('post-game');
const rematchBtn = document.getElementById('rematch-btn');
const quitBtn = document.getElementById('quit-btn');
const rematchStatus = document.getElementById('rematch-status');
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');
const localModeBtn = document.getElementById('local-mode-btn');
const onlineModeBtn = document.getElementById('online-mode-btn');
const backToModesBtn = document.getElementById('back-to-modes');
const exitGameBtn = document.getElementById('exit-game');
const turnInstruction = document.getElementById('turn-instruction');
const sideControls = document.getElementById('side-controls');
const timeLeftSpan = document.getElementById('time-left');
const timerDisplay = document.getElementById('timer-display');
const settingLength = document.getElementById('setting-length');
const settingTime = document.getElementById('setting-time');

// モード選択
localModeBtn.addEventListener('click', () => {
    gameMode = 'local';
    startLocalGame();
});

onlineModeBtn.addEventListener('click', () => {
    gameMode = 'online';
    modeSelectionDiv.classList.add('hidden');
    lobbyDiv.classList.remove('hidden');
});

backToModesBtn.addEventListener('click', () => {
    lobbyDiv.classList.add('hidden');
    modeSelectionDiv.classList.remove('hidden');
});

function startLocalGame(isRematch = false) {
    modeSelectionDiv.classList.add('hidden');
    gameDiv.classList.remove('hidden');
    exitGameBtn.classList.remove('hidden');
    displayRoomId.parentElement.classList.add('hidden');
    sideControls.classList.remove('hidden');
    timerDisplay.classList.add('hidden');

    targetLength = parseInt(settingLength.value);
    
    localBoard = Array(25).fill(null);
    if (isRematch) {
        localStartingPlayer = 1 - localStartingPlayer;
        localTurn = localStartingPlayer;
    } else {
        localStartingPlayer = 0;
        localTurn = 0;
    }
    
    initBoard();
    updateLocalTurn();
    
    overlay.classList.add('hidden');
    statusDiv.style.color = '#555';
}

exitGameBtn.addEventListener('click', () => {
    location.reload();
});

// 盤面の初期化
function initBoard() {
    boardDiv.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.index = i;
        cell.addEventListener('click', () => handleCellClick(i));
        boardDiv.appendChild(cell);
    }
}

// 部屋作成
createRoomBtn.addEventListener('click', () => {
    const settings = {
        targetLength: settingLength.value,
        timeLimit: settingTime.value
    };
    socket.emit('createRoom', settings);
});

socket.on('roomCreated', (roomId) => {
    currentRoomId = roomId;
    myPlayerIndex = 0;
    showGame();
    displayRoomId.textContent = roomId;
    statusDiv.textContent = '対戦相手を待っています...';
});

// 部屋参加
joinRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (roomId) {
        socket.emit('joinRoom', roomId);
    }
});

socket.on('gameStart', ({ roomId, players, turn, targetLength: len, timeLimit: time }) => {
    currentRoomId = roomId;
    targetLength = len || 4;
    timeLimit = time || 30;
    
    if (myPlayerIndex === -1) {
        myPlayerIndex = players.findIndex(id => id === socket.id);
    }
    showGame();
    displayRoomId.parentElement.classList.remove('hidden');
    displayRoomId.textContent = roomId;
    updateTurn(turn);
    initBoard();
    
    postGameDiv.classList.add('hidden');
    rematchStatus.textContent = '';
    rematchBtn.disabled = false;
    overlay.classList.add('hidden');
    statusDiv.style.color = '#555';
    sideControls.classList.remove('hidden');
    timerDisplay.classList.remove('hidden');
});

socket.on('timerUpdate', (timeLeft) => {
    timeLeftSpan.textContent = timeLeft;
    if (timeLeft <= 5) {
        timeLeftSpan.style.color = 'red';
    } else {
        timeLeftSpan.style.color = 'inherit';
    }
});

function showGame() {
    lobbyDiv.classList.add('hidden');
    gameDiv.classList.remove('hidden');
}

function updateTurn(turn) {
    isMyTurn = (turn === myPlayerIndex);
    if (isMyTurn) {
        statusDiv.textContent = 'あなたの番です！';
        statusDiv.style.color = '#e91e63';
        controlsDiv.classList.remove('hidden');
        sideControls.classList.remove('hidden');
    } else {
        statusDiv.textContent = '相手の番です...';
        statusDiv.style.color = '#555';
        controlsDiv.classList.add('hidden');
        sideControls.classList.add('hidden');
    }
}

function updateLocalTurn() {
    const playerNum = localTurn + 1;
    statusDiv.textContent = `プレイヤー ${playerNum} の番です`;
    statusDiv.style.color = localTurn === 0 ? '#007bff' : '#e91e63';
    turnInstruction.textContent = `プレイヤー ${playerNum}：配置する文字を選択`;
    controlsDiv.classList.remove('hidden');
    sideControls.classList.remove('hidden'); // Added here just in case
}

// 文字選択
symbolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        symbolBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        mySymbol = btn.dataset.symbol;
    });
});

// セルクリック
function handleCellClick(index) {
    const cells = document.querySelectorAll('.cell');
    if (gameMode === 'online') {
        if (!isMyTurn) return;
        
        if (cells[index].classList.contains('taken')) {
            cells[index].classList.add('shake');
            setTimeout(() => cells[index].classList.remove('shake'), 400);
            return;
        }

        socket.emit('makeMove', {
            roomId: currentRoomId,
            index: index,
            symbol: mySymbol
        });
    } else if (gameMode === 'local') {
        if (localBoard[index] !== null) {
            cells[index].classList.add('shake');
            setTimeout(() => cells[index].classList.remove('shake'), 400);
            return;
        }
        
        localBoard[index] = mySymbol;
        cells[index].textContent = mySymbol;
        cells[index].classList.add('taken');
        
        const winResult = checkWinLocal(localBoard);
        if (winResult) {
            highlightWinningCells(winResult);
            showOverlay(`プレイヤー ${localTurn + 1} の勝利！`, 'win-text');
            statusDiv.textContent = `プレイヤー ${localTurn + 1} の勝ち！`;
            controlsDiv.classList.add('hidden');
            sideControls.classList.add('hidden');
            postGameDiv.classList.remove('hidden');
            rematchBtn.textContent = 'もう一度遊ぶ';
        } else if (localBoard.every(cell => cell !== null)) {
            showOverlay('引き分け', 'draw-text');
            statusDiv.textContent = '引き分けです';
            controlsDiv.classList.add('hidden');
            sideControls.classList.add('hidden');
            postGameDiv.classList.remove('hidden');
        } else {
            localTurn = 1 - localTurn;
            updateLocalTurn();
        }
    }
}

function highlightWinningCells(indices) {
    const cells = document.querySelectorAll('.cell');
    indices.forEach(idx => {
        if (cells[idx]) {
            cells[idx].classList.add('winning-cell');
        }
    });
}

socket.on('updateBoard', ({ board, turn }) => {
    const cells = document.querySelectorAll('.cell');
    board.forEach((symbol, i) => {
        if (symbol) {
            cells[i].textContent = symbol;
            cells[i].classList.add('taken');
        }
    });
    updateTurn(turn);
});

socket.on('gameEnd', ({ board, winner, reason }) => {
    timerDisplay.classList.add('hidden');
    
    const cells = document.querySelectorAll('.cell');
    board.forEach((symbol, i) => {
        if (symbol) {
            cells[i].textContent = symbol;
            cells[i].classList.add('taken');
        }
    });

    const winResult = checkWinLocal(board);
    if (winResult) highlightWinningCells(winResult);

    isMyTurn = false;
    controlsDiv.classList.add('hidden');
    sideControls.classList.add('hidden');
    postGameDiv.classList.remove('hidden');

    if (reason === 'win') {
        if (winner === socket.id) {
            showOverlay('勝利！', 'win-text');
            statusDiv.textContent = 'あなたの勝ちです！おめでとう！';
            statusDiv.style.color = '#ffc107';
        } else {
            showOverlay('敗北...', 'lose-text');
            statusDiv.textContent = 'あなたの負けです...';
            statusDiv.style.color = '#007bff';
        }
    } else if (reason === 'timeout') {
        if (winner === socket.id) {
            showOverlay('勝利！', 'win-text');
            statusDiv.textContent = '相手の時間切れです。あなたの勝ち！';
            statusDiv.style.color = '#ffc107';
        } else {
            showOverlay('時間切れ...', 'lose-text');
            statusDiv.textContent = '時間切れです。あなたの負け...';
            statusDiv.style.color = '#007bff';
        }
    } else {
        showOverlay('引き分け', 'draw-text');
        statusDiv.textContent = '引き分けです。';
        statusDiv.style.color = '#28a745';
    }
});

function showOverlay(text, className) {
    overlayContent.textContent = text;
    overlayContent.className = className;
    overlay.classList.remove('hidden');
    
    const timeoutId = setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);

    overlay.onclick = () => {
        clearTimeout(timeoutId);
        overlay.classList.add('hidden');
    };
}

rematchBtn.addEventListener('click', () => {
    if (gameMode === 'online') {
        socket.emit('requestRematch', currentRoomId);
        rematchBtn.disabled = true;
        rematchStatus.textContent = '相手の返答を待っています...';
    } else {
        startLocalGame(true);
        postGameDiv.classList.add('hidden');
    }
});

quitBtn.addEventListener('click', () => {
    if (gameMode === 'online') {
        socket.emit('quitGame', currentRoomId);
    }
    location.reload();
});

socket.on('rematchRequested', () => {
    rematchStatus.textContent = '相手が再戦を希望しています！';
});

socket.on('playerQuit', () => {
    alert('相手が部屋を退出しました。');
    location.reload();
});

socket.on('playerDisconnected', () => {
    statusDiv.textContent = '相手が切断しました。';
    statusDiv.style.color = 'gray';
    isMyTurn = false;
});

socket.on('error', (msg) => {
    alert(msg);
});

function checkWinLocal(board) {
    const size = 5;
    const baseTarget = ['ち', 'ん'];
    const target = [];
    for (let i = 0; i < targetLength; i++) {
        target.push(baseTarget[i % 2]);
    }

    const directions = [
        [1, 0], [0, 1], [1, 1], [-1, 1]
    ];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            for (const [dx, dy] of directions) {
                const indices = checkLineLocal(board, x, y, dx, dy, target);
                if (indices) return indices;
            }
        }
    }
    return null;
}

function checkLineLocal(board, x, y, dx, dy, target) {
    const size = 5;
    const indices = [];
    for (let i = 0; i < target.length; i++) {
        const nx = x + i * dx;
        const ny = y + i * dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) return null;
        if (board[ny * size + nx] !== target[i]) return null;
        indices.push(ny * size + nx);
    }
    return indices;
}
