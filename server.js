JavaScript
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 8000; 

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Minesweeper Chess Server is running!');
    }
});

const io = new Server(server, {
    cors: {
        origin: "https://ssambender.github.io",
        methods: ["GET", "POST"],
        credentials: true
    }
});

const ROWS = 16;
const COLS = 8;
const MINES_COUNT = 20;

const pieceNames = { 'P': 'Pawn', 'R': 'Rook', 'N': 'Knight', 'B': 'Bishop', 'Q': 'Queen', 'K': 'King' };

// store multiple games mapped by roomCode
const games = {};

function getInitialGameState() {
    return {
        players: { white: null, black: null },
        turn: 'white',
        pieces: initializeChessPieces(),
        deadPieces: { white: [], black: [] },
        winner: null, 
        mines: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
        revealedWhite: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
        revealedBlack: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
        flagsWhite: Array(ROWS).fill(null).map(() => Array(COLS).fill(0)),
        flagsBlack: Array(ROWS).fill(null).map(() => Array(COLS).fill(0)),
        firstMoveWhite: null,
        firstMoveBlack: null,
        minesGenerated: false,
        gameStarted: false,
        timeRemaining: 1200,
        timerInterval: null
    };
}

function initializeChessPieces() {
    const pieces = [];
    const backRowBlack = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (let c = 0; c < 8; c++) {
        pieces.push({ id: `b-p-${c}`, type: 'P', color: 'black', x: c, y: 1 });
        pieces.push({ id: `b-${c}`, type: backRowBlack[c], color: 'black', x: c, y: 0 });
    }
    
    pieces.push({ id: 'w-r-0', type: 'R', color: 'white', x: 0, y: 15 });
    pieces.push({ id: 'w-n-0', type: 'N', color: 'white', x: 1, y: 15 });
    pieces.push({ id: 'w-b-0', type: 'B', color: 'white', x: 2, y: 15 });
    pieces.push({ id: 'w-k',   type: 'K', color: 'white', x: 3, y: 15 }); 
    pieces.push({ id: 'w-q',   type: 'Q', color: 'white', x: 4, y: 15 }); 
    pieces.push({ id: 'w-b-1', type: 'B', color: 'white', x: 5, y: 15 });
    pieces.push({ id: 'w-n-1', type: 'N', color: 'white', x: 6, y: 15 });
    pieces.push({ id: 'w-r-1', type: 'R', color: 'white', x: 7, y: 15 });
    
    for (let c = 0; c < 8; c++) {
        pieces.push({ id: `w-p-${c}`, type: 'P', color: 'white', x: c, y: 14 });
    }
    
    return pieces;
}

function isPathClear(startX, startY, endX, endY, pieces) {
    const dx = Math.sign(endX - startX);
    const dy = Math.sign(endY - startY);
    let x = startX + dx, y = startY + dy;
    while (x !== endX || y !== endY) {
        if (pieces.some(p => p.x === x && p.y === y)) return false;
        x += dx; y += dy;
    }
    return true;
}

function isValidMove(piece, toX, toY, pieces) {
    const dx = toX - piece.x, dy = toY - piece.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (pieces.some(p => p.x === toX && p.y === toY && p.color === piece.color)) return false;
    const targetPiece = pieces.find(p => p.x === toX && p.y === toY);

    switch (piece.type) {
        case 'N': return (adx === 2 && ady === 1) || (adx === 1 && ady === 2);
        case 'K': return adx <= 1 && ady <= 1;
        case 'R': if (dx !== 0 && dy !== 0) return false; return isPathClear(piece.x, piece.y, toX, toY, pieces);
        case 'B': if (adx !== ady) return false; return isPathClear(piece.x, piece.y, toX, toY, pieces);
        case 'Q': if (dx !== 0 && dy !== 0 && adx !== ady) return false; return isPathClear(piece.x, piece.y, toX, toY, pieces);
        case 'P': 
            const dir = piece.color === 'white' ? -1 : 1;
            const startRow = piece.color === 'white' ? 14 : 1;
            if (dx === 0) {
                if (dy === dir && !targetPiece) return true;
                if (dy === dir * 2 && piece.y === startRow && !targetPiece && isPathClear(piece.x, piece.y, toX, toY, pieces)) return true;
            } else if (adx === 1 && dy === dir && targetPiece) return true;
            return false;
    }
    return false;
}

function isProtected(x, y, safeSpots) {
    for (let safe of safeSpots) {
        if (Math.abs(x - safe.x) <= 1 && Math.abs(y - safe.y) <= 1) return true;
    }
    return false;
}

function generateMines(gs, safeW, safeB) {
    let placed = 0;
    const safeSpots = [safeW, safeB];
    while (placed < MINES_COUNT) {
        let x = Math.floor(Math.random() * COLS);
        let y = Math.floor(Math.random() * 12) + 2; 
        if (isProtected(x, y, safeSpots)) continue; 
        if (!gs.mines[y][x]) {
            gs.mines[y][x] = true;
            placed++;
        }
    }
    gs.minesGenerated = true;
}

function getAdjacentMines(gs, x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            let ny = y + dy, nx = x + dx;
            if (ny >= 2 && ny <= 13 && nx >= 0 && nx < COLS) {
                if (gs.mines[ny][nx]) count++;
            }
        }
    }
    return count;
}

function floodFill(gs, x, y, color) {
    const revealedState = color === 'white' ? gs.revealedWhite : gs.revealedBlack;
    if (y < 2 || y > 13 || x < 0 || x >= COLS) return;
    if (revealedState[y][x]) return;
    revealedState[y][x] = true;
    if (getAdjacentMines(gs, x, y) === 0) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx !== 0 || dy !== 0) floodFill(gs, x + dx, y + dy, color);
            }
        }
    }
}

function resetGame(roomCode) {
    const gs = games[roomCode];
    if (!gs) return;

    if (gs.timerInterval) clearInterval(gs.timerInterval);
    
    // create new state but maintain players
    const newGs = getInitialGameState();
    newGs.players = { white: null, black: null }; // resets colors
    games[roomCode] = newGs;

    // remove colors from clients
    const room = io.sockets.adapter.rooms.get(roomCode);
    if (room) {
        for (const clientId of room) {
            const clientSocket = io.sockets.sockets.get(clientId);
            if (clientSocket) clientSocket.color = null;
        }
    }

    io.to(roomCode).emit('resetLobby');
    broadcastState(roomCode);
}

function broadcastState(roomCode) {
    const gs = games[roomCode];
    if (!gs) return;

    const room = io.sockets.adapter.rooms.get(roomCode);
    if (room) {
        for (const clientId of room) {
            const clientSocket = io.sockets.sockets.get(clientId);
            if (clientSocket) {
                const color = clientSocket.color || 'none';
                const revealedState = color === 'white' ? gs.revealedWhite : gs.revealedBlack;
                const flags = color === 'white' ? gs.flagsWhite : gs.flagsBlack;
                
                const visibleGrid = revealedState.map((row, y) => 
                    row.map((val, x) => val === 'X' ? 'X' : (val === true ? getAdjacentMines(gs, x, y) : null))
                );

                const truthGrid = gs.minesGenerated ? Array(ROWS).fill(null).map((_, y) => 
                    Array(COLS).fill(null).map((_, x) => gs.mines[y][x] ? 'M' : getAdjacentMines(gs, x, y))
                ) : null;

                clientSocket.emit('stateUpdate', {
                    turn: gs.turn,
                    pieces: gs.pieces,
                    deadPieces: gs.deadPieces, 
                    winner: gs.winner,
                    color: color,
                    grid: visibleGrid,
                    truthGrid: truthGrid,
                    flags: flags,
                    gameStarted: gs.gameStarted,
                    timeRemaining: gs.timeRemaining,
                    seats: {
                        white: gs.players.white !== null,
                        black: gs.players.black !== null
                    }
                });
            }
        }
    }
}

function broadcastGameOver(roomCode, winner, reason) {
    const gs = games[roomCode];
    if (gs && gs.timerInterval) clearInterval(gs.timerInterval);
    io.to(roomCode).emit('gameOver', { winner, reason });
}

io.on('connection', (socket) => {
    socket.color = null;
    socket.roomCode = null;

    // HOST CREATES NEW ROOM
    socket.on('createRoom', () => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let code = '';
        do {
            code = '';
            for (let i = 0; i < 4; i++) {
                code += characters.charAt(Math.floor(Math.random() * characters.length));
            }
        } while (games[code]); // ensure unique room code

        games[code] = getInitialGameState();
        socket.join(code);
        socket.roomCode = code;
        socket.emit('roomCreated', { roomCode: code });
        broadcastState(code);
    });

    // PLAYER JOINS ROOM
    socket.on('joinRoom', ({ roomCode }) => {
        const code = roomCode.toUpperCase();
        if (games[code]) {
            socket.join(code);
            socket.roomCode = code;
            socket.emit('joinedRoom', { roomCode: code });
            broadcastState(code);
        } else {
            socket.emit('errorMsg', "Room not found!");
        }
    });

    // SELECT TEAM COLOR
    socket.on('selectColor', ({ color }) => {
        const code = socket.roomCode;
        if (!code || !games[code]) return;
        
        const gs = games[code];
        if (color === 'white' || color === 'black') {
            if (gs.players[color] === null) {
                socket.color = color;
                gs.players[color] = socket.id;
                socket.emit('joinSuccess', { color });
                
                // Start game if both players joined
                if (!gs.gameStarted && gs.players.white && gs.players.black) {
                    gs.gameStarted = true;
                    gs.timeRemaining = 1200;
                    
                    gs.timerInterval = setInterval(() => {
                        gs.timeRemaining--;
                        io.to(code).emit('timeUpdate', { time: gs.timeRemaining });

                        if (gs.timeRemaining <= 0) {
                            clearInterval(gs.timerInterval);
                            gs.winner = 'draw';
                            broadcastGameOver(code, 'draw', 'Time ran out!');
                        }
                    }, 1000);
                }
                
                broadcastState(code); 
            } else {
                socket.emit('errorMsg', 'Seat already taken!');
            }
        }
    });

    socket.on('flag', ({ x, y }) => {
        const code = socket.roomCode;
        if (!code || !games[code] || socket.color === 'none') return;
        
        const gs = games[code];
        if (gs.winner || !gs.gameStarted) return;

        const hasPiece = gs.pieces.some(p => p.x === x && p.y === y);
        if (!hasPiece && y >= 2 && y <= 13) {
            if (socket.color === 'white') gs.flagsWhite[y][x] = (gs.flagsWhite[y][x] + 1) % 3;
            if (socket.color === 'black') gs.flagsBlack[y][x] = (gs.flagsBlack[y][x] + 1) % 3;
            broadcastState(code);
        }
    });

    socket.on('move', ({ id, toX, toY }) => {
        const code = socket.roomCode;
        if (!code || !games[code] || !socket.color) return;

        const gs = games[code];
        if (gs.winner || !gs.gameStarted || socket.color !== gs.turn) return;
        
        const revealedState = socket.color === 'white' ? gs.revealedWhite : gs.revealedBlack;
        if (toY >= 2 && toY <= 13 && revealedState[toY][toX] === 'X') {
            return; 
        }

        const movingPiece = gs.pieces.find(p => p.id === id);
        if (!movingPiece) return;
        
        if (!isValidMove(movingPiece, toX, toY, gs.pieces)) return;

        const targetPiece = gs.pieces.find(p => p.x === toX && p.y === toY);
        if (targetPiece) {
            gs.deadPieces[targetPiece.color].push(targetPiece);
            gs.pieces = gs.pieces.filter(p => p.id !== targetPiece.id);

            if (targetPiece.type === 'K') {
                gs.winner = socket.color; 
                broadcastGameOver(code, socket.color, `${pieceNames[targetPiece.type]} was captured!`);
            }
        }

        movingPiece.x = toX;
        movingPiece.y = toY;

        if (toY >= 2 && toY <= 13) {
            if (socket.color === 'white' && !gs.firstMoveWhite) gs.firstMoveWhite = {x: toX, y: toY};
            if (socket.color === 'black' && !gs.firstMoveBlack) gs.firstMoveBlack = {x: toX, y: toY};
        }

        if (!gs.minesGenerated && gs.firstMoveWhite && gs.firstMoveBlack) {
            generateMines(gs, gs.firstMoveWhite, gs.firstMoveBlack);
            floodFill(gs, gs.firstMoveWhite.x, gs.firstMoveWhite.y, 'white');
            floodFill(gs, gs.firstMoveBlack.x, gs.firstMoveBlack.y, 'black');
        }

        if (gs.minesGenerated && toY >= 2 && toY <= 13) {
            if (gs.mines[toY][toX]) {
                gs.deadPieces[movingPiece.color].push(movingPiece);
                gs.pieces = gs.pieces.filter(p => p.id !== movingPiece.id);
                
                if (socket.color === 'white') gs.revealedWhite[toY][toX] = 'X';
                if (socket.color === 'black') gs.revealedBlack[toY][toX] = 'X';
                
                socket.emit('explosion', { message: `Your ${pieceNames[movingPiece.type]} exploded!` });

                if (movingPiece.type === 'K') {
                    gs.winner = socket.color === 'white' ? 'black' : 'white';
                    broadcastGameOver(code, gs.winner, `${socket.color}'s King exploded on a mine!`);
                }

            } else {
                floodFill(gs, toX, toY, socket.color);
            }
        }

        gs.turn = gs.turn === 'white' ? 'black' : 'white';
        broadcastState(code);
    });

    socket.on('endGame', () => {
        const code = socket.roomCode;
        if (code && games[code]) {
            resetGame(code);
        }
    });

    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (code && games[code]) {
            const gs = games[code];
            if (socket.color === 'white') gs.players.white = null;
            if (socket.color === 'black') gs.players.black = null;
            
            // clean up room if both players leave
            if (!gs.players.white && !gs.players.black) {
                if (gs.timerInterval) clearInterval(gs.timerInterval);
                delete games[code];
            } else {
                broadcastState(code);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log('Socket.io server running on port ' + PORT);
});
