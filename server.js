const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const FPS = 60;
const FRICTION = 0.97;
const TURN_SPEED = 240;
const LASER_SPD = 750;
const WIDTH = 1200;
const HEIGHT = 800;

let gameState = { players: {}, lasers: [], roids: [], items: [] };
let isGameOver = false; // Controle de estado da partida

function spawnAsteroids() {
    gameState.roids = [];
    for (let i = 0; i < 5; i++) {
        gameState.roids.push({
            x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: 45,
            xv: (Math.random() * 100 / FPS) * (Math.random() < 0.5 ? 1 : -1),
            yv: (Math.random() * 100 / FPS) * (Math.random() < 0.5 ? 1 : -1),
            a: Math.random() * Math.PI * 2,
            rot: (Math.random() * 8 / FPS) * (Math.random() < 0.5 ? 1 : -1),
            vert: Math.floor(Math.random() * 5 + 7),
            offs: Array.from({length: 12}, () => Math.random() * 0.3 * 2 + 0.85)
        });
    }
}
spawnAsteroids();

io.on('connection', (socket) => {
    socket.on('ping', () => socket.emit('pong'));

    socket.on('joinGame', (data) => {
        gameState.players[socket.id] = {
            id: socket.id, name: data.name, color: data.color,
            x: Math.random() * WIDTH, y: Math.random() * HEIGHT,
            r: 18, a: Math.PI / 2, rot: 0, thrusting: false, thrust: { x: 0, y: 0 },
            hp: 100, lastShot: 0, shieldTimer: 0, tripleTimer: 0, speedTimer: 0
        };
    });

    socket.on('playerInput', (keys) => {
        if (isGameOver) return; // Bloqueia controles se o jogo acabou
        
        let p = gameState.players[socket.id];
        if (!p) return;

        p.rot = 0;
        if (keys.left) p.rot = TURN_SPEED / 180 * Math.PI / FPS;
        if (keys.right) p.rot = -TURN_SPEED / 180 * Math.PI / FPS;
        p.thrusting = keys.up;

        if (keys.shoot && Date.now() - p.lastShot > 250) {
            gameState.lasers.push({
                x: p.x + 4/3 * p.r * Math.cos(p.a), y: p.y - 4/3 * p.r * Math.sin(p.a),
                xv: LASER_SPD * Math.cos(p.a) / FPS, yv: -LASER_SPD * Math.sin(p.a) / FPS,
                owner: socket.id, r: 3
            });
            p.lastShot = Date.now();
        }
    });

    socket.on('disconnect', () => { delete gameState.players[socket.id]; });
});

function distBetweenPoints(x1, y1, x2, y2) { 
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)); 
}

setInterval(() => {
    // Se o jogo acabou, apenas envia a tela congelada e não calcula a física
    if (isGameOver) {
        io.emit('gameState', gameState);
        return;
    }

    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (p.thrusting) {
            let accel = p.speedTimer > 0 ? 20 : 12; 
            p.thrust.x += accel * Math.cos(p.a) / FPS;
            p.thrust.y -= accel * Math.sin(p.a) / FPS;
        } else {
            p.thrust.x *= FRICTION; p.thrust.y *= FRICTION;
        }
        p.a += p.rot; p.x += p.thrust.x; p.y += p.thrust.y;

        if (p.x < -p.r) p.x = WIDTH + p.r; else if (p.x > WIDTH + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = HEIGHT + p.r; else if (p.y > HEIGHT + p.r) p.y = -p.r;

        if (p.shieldTimer > 0) p.shieldTimer--;
        if (p.tripleTimer > 0) p.tripleTimer--;
        if (p.speedTimer > 0) p.speedTimer--;
    }

    for (let r of gameState.roids) {
        r.x += r.xv; r.y += r.yv; r.a += r.rot;
        if (r.x < -r.r) r.x = WIDTH + r.r; else if (r.x > WIDTH + r.r) r.x = -r.r;
        if (r.y < -r.r) r.y = HEIGHT + r.r; else if (r.y > HEIGHT + r.r) r.y = -r.r;
    }

    for (let i = gameState.lasers.length - 1; i >= 0; i--) {
        let l = gameState.lasers[i];
        l.x += l.xv; l.y += l.yv;

        if (l.x < 0 || l.x > WIDTH || l.y < 0 || l.y > HEIGHT) {
            gameState.lasers.splice(i, 1); continue;
        }

        let laserDestroyed = false;
        for (let r of gameState.roids) {
            if (distBetweenPoints(l.x, l.y, r.x, r.y) < r.r) {
                gameState.lasers.splice(i, 1); laserDestroyed = true; break;
            }
        }
        if (laserDestroyed) continue;

        for (let id in gameState.players) {
            let p = gameState.players[id];
            if (l.owner !== id && distBetweenPoints(l.x, l.y, p.x, p.y) < p.r) {
                if (!(p.shieldTimer > 0)) p.hp -= 10;
                gameState.lasers.splice(i, 1);
                
                // SISTEMA DE MORTE E VITÓRIA
                if (p.hp <= 0) {
                    isGameOver = true;
                    let killer = gameState.players[l.owner];
                    
                    // Avisa a todos quem ganhou
                    io.emit('gameOver', { 
                        winnerName: killer ? killer.name : 'O Vácuo do Espaço',
                        winnerColor: killer ? killer.color : '#fff'
                    });

                    // Conta 4 segundos e Reinicia a Arena
                    setTimeout(() => {
                        for (let pid in gameState.players) {
                            gameState.players[pid].hp = 100;
                            gameState.players[pid].x = Math.random() * WIDTH;
                            gameState.players[pid].y = Math.random() * HEIGHT;
                            gameState.players[pid].thrust = { x: 0, y: 0 };
                        }
                        gameState.lasers = [];
                        spawnAsteroids(); // Reseta os asteroides também
                        isGameOver = false;
                        io.emit('gameRestart');
                    }, 4000);
                }
                break;
            }
        }
    }
    io.emit('gameState', gameState);
}, 1000 / FPS);

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`[SERVER] Arena 1v1 rodando na porta ${port}`);
});
