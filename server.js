const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const ROWS = 16;
const COLS = 8;
const MINES_COUNT = 20;

const pieceNames = { 'P': 'Pawn', 'R': 'Rook', 'N': 'Knight', 'B': 'Bishop', 'Q': 'Queen', 'K': 'King' };

let gameState = {
    players: { white: null, black: null },
    turn: 'white',
    pieces: initializeChessPieces(),
    mines: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
    revealedWhite: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
    revealedBlack: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
    flagsWhite: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
    flagsBlack: Array(ROWS).fill(null).map(() => Array(COLS).fill(false)),
    firstMoveWhite: null,
    firstMoveBlack: null,
    minesGenerated: false
};

function initializeChessPieces() {
    const pieces = [];
    const backRow = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (let c = 0; c < 8; c++) {
        pieces.push({ id: `b-p-${c}`, type: 'P', color: 'black', x: c, y: 1 });
        pieces.push({ id: `b-${c}`, type: backRow[c], color: 'black', x: c, y: 0 });
        pieces.push({ id: `w-p-${c}`, type: 'P', color: 'white', x: c, y: 14 });
        pieces.push({ id: `w-${c}`, type: backRow[c], color: 'white', x: c, y: 15 });
    }
    return pieces;
}

// chess movement validation
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
    // keep a 3x3 grid around the starting move clear of mines
    for (let safe of safeSpots) {
        if (Math.abs(x - safe.x) <= 1 && Math.abs(y - safe.y) <= 1) return true;
    }
    return false;
}

function generateMines(safeW, safeB) {
    let placed = 0;
    const safeSpots = [safeW, safeB];
    while (placed < MINES_COUNT) {
        let x = Math.floor(Math.random() * COLS);
        let y = Math.floor(Math.random() * 12) + 2; 
        
        if (isProtected(x, y, safeSpots)) continue; // ensure zero-start
        
        if (!gameState.mines[y][x]) {
            gameState.mines[y][x] = true;
            placed++;
        }
    }
    gameState.minesGenerated = true;
}

function getAdjacentMines(x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            let ny = y + dy, nx = x + dx;
            if (ny >= 2 && ny <= 13 && nx >= 0 && nx < COLS) {
                if (gameState.mines[ny][nx]) count++;
            }
        }
    }
    return count;
}

function floodFill(x, y, color) {
    const revealedState = color === 'white' ? gameState.revealedWhite : gameState.revealedBlack;
    
    // stop if out of bounds (only flood fill the mine zone)
    if (y < 2 || y > 13 || x < 0 || x >= COLS) return;
    
    // stop if already revealed or exploded
    if (revealedState[y][x]) return;
    
    // reveal space
    revealedState[y][x] = true;

    // if zero, recurse to all 8 adjacent neighbors
    if (getAdjacentMines(x, y) === 0) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx !== 0 || dy !== 0) floodFill(x + dx, y + dy, color);
            }
        }
    }
}

function broadcastState() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const color = client.color;
            const revealedState = color === 'white' ? gameState.revealedWhite : gameState.revealedBlack;
            const flags = color === 'white' ? gameState.flagsWhite : gameState.flagsBlack;
            
            const visibleGrid = revealedState.map((row, y) => 
                row.map((val, x) => val === 'X' ? 'X' : (val === true ? getAdjacentMines(x, y) : null))
            );

            const truthGrid = gameState.minesGenerated ? Array(ROWS).fill(null).map((_, y) => 
                Array(COLS).fill(null).map((_, x) => gameState.mines[y][x] ? 'M' : getAdjacentMines(x, y))
            ) : null;

            client.send(JSON.stringify({
                type: 'STATE_UPDATE',
                turn: gameState.turn,
                pieces: gameState.pieces,
                color: color,
                grid: visibleGrid,
                truthGrid: truthGrid,
                flags: flags
            }));
        }
    });
}

wss.on('connection', (ws) => {
    if (!gameState.players.white) { ws.color = 'white'; gameState.players.white = ws; } 
    else if (!gameState.players.black) { ws.color = 'black'; gameState.players.black = ws; } 
    else { ws.color = 'spectator'; }

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'FLAG' && ws.color !== 'spectator') {
            const { x, y } = data;
            const hasPiece = gameState.pieces.some(p => p.x === x && p.y === y);
            if (!hasPiece && y >= 2 && y <= 13) {
                if (ws.color === 'white') gameState.flagsWhite[y][x] = !gameState.flagsWhite[y][x];
                if (ws.color === 'black') gameState.flagsBlack[y][x] = !gameState.flagsBlack[y][x];
                broadcastState();
            }
            return;
        }

        if (data.type === 'MOVE' && ws.color === gameState.turn) {
            const { id, toX, toY } = data;
            const pieceIndex = gameState.pieces.findIndex(p => p.id === id);
            if (pieceIndex === -1) return;
            
            const piece = gameState.pieces[pieceIndex];
            if (!isValidMove(piece, toX, toY, gameState.pieces)) return;

            gameState.pieces = gameState.pieces.filter(p => !(p.x === toX && p.y === toY));
            gameState.pieces[pieceIndex].x = toX;
            gameState.pieces[pieceIndex].y = toY;

            if (toY >= 2 && toY <= 13) {
                if (ws.color === 'white' && !gameState.firstMoveWhite) gameState.firstMoveWhite = {x: toX, y: toY};
                if (ws.color === 'black' && !gameState.firstMoveBlack) gameState.firstMoveBlack = {x: toX, y: toY};
            }

            if (!gameState.minesGenerated && gameState.firstMoveWhite && gameState.firstMoveBlack) {
                generateMines(gameState.firstMoveWhite, gameState.firstMoveBlack);
                // trigger flood fill for both initial placements simultaneously
                floodFill(gameState.firstMoveWhite.x, gameState.firstMoveWhite.y, 'white');
                floodFill(gameState.firstMoveBlack.x, gameState.firstMoveBlack.y, 'black');
            }

            if (gameState.minesGenerated && toY >= 2 && toY <= 13) {
                if (gameState.mines[toY][toX]) {
                    gameState.pieces = gameState.pieces.filter(p => p.id !== id);
                    if (ws.color === 'white') gameState.revealedWhite[toY][toX] = 'X';
                    if (ws.color === 'black') gameState.revealedBlack[toY][toX] = 'X';
                    ws.send(JSON.stringify({ type: 'EXPLOSION', message: `Your ${pieceNames[piece.type]} exploded!` }));
                } else {
                    // safe move triggers flood fill
                    floodFill(toX, toY, ws.color);
                }
            }

            gameState.turn = gameState.turn === 'white' ? 'black' : 'white';
            broadcastState();
        }
    });

    broadcastState();
});

console.log('WebSocket server running on ws://localhost:8080');