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
const LASER_SPD = 850; 
const WIDTH = 1920;    
const HEIGHT = 1080;   

let gameState = { players: {}, lasers: [], roids: [], items: [] };
let isGameOver = false; 

function spawnAsteroids() {
    gameState.roids = [];
    for (let i = 0; i < 8; i++) {
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

setInterval(() => {
    if (!isGameOver && gameState.items.length < 4) { 
        const types = ['TRIPLE', 'SHIELD', 'SPEED'];
        gameState.items.push({
            x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: 25,
            type: types[Math.floor(Math.random() * types.length)]
        });
    }
}, 3000); 

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        gameState.players[socket.id] = {
            id: socket.id, name: data.name, color: data.color,
            x: Math.random() * WIDTH, y: Math.random() * HEIGHT,
            r: 20, a: Math.PI / 2, rot: 0, thrusting: false, thrust: { x: 0, y: 0 },
            hp: 100, lastShot: 0, shieldTimer: 0, tripleTimer: 0, speedTimer: 0
        };
    });

    socket.on('playerInput', (keys) => {
        if (isGameOver) return; 
        let p = gameState.players[socket.id];
        if (!p) return;
        p.rot = 0;
        if (keys.left) p.rot = TURN_SPEED / 180 * Math.PI / FPS;
        if (keys.right) p.rot = -TURN_SPEED / 180 * Math.PI / FPS;
        p.thrusting = keys.up;
        if (keys.shoot && Date.now() - p.lastShot > 250) {
            let speed = LASER_SPD / FPS;
            gameState.lasers.push({
                x: p.x + 4/3 * p.r * Math.cos(p.a), y: p.y - 4/3 * p.r * Math.sin(p.a),
                xv: speed * Math.cos(p.a), yv: -speed * Math.sin(p.a), owner: socket.id, r: 4
            });
            if (p.tripleTimer > 0) {
                gameState.lasers.push({ x: p.x, y: p.y, xv: speed * Math.cos(p.a+0.25), yv: -speed * Math.sin(p.a+0.25), owner: socket.id, r: 4 });
                gameState.lasers.push({ x: p.x, y: p.y, xv: speed * Math.cos(p.a-0.25), yv: -speed * Math.sin(p.a-0.25), owner: socket.id, r: 4 });
            }
            p.lastShot = Date.now();
        }
    });
    socket.on('disconnect', () => { delete gameState.players[socket.id]; });
});

function distBetweenPoints(x1, y1, x2, y2) { return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)); }

setInterval(() => {
    if (isGameOver) { io.emit('gameState', gameState); return; }
    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (p.thrusting) {
            let accel = p.speedTimer > 0 ? 25 : 12;
            p.thrust.x += accel * Math.cos(p.a) / FPS;
            p.thrust.y -= accel * Math.sin(p.a) / FPS;
        } else { p.thrust.x *= FRICTION; p.thrust.y *= FRICTION; }
        p.a += p.rot; p.x += p.thrust.x; p.y += p.thrust.y;
        if (p.x < -p.r) p.x = WIDTH + p.r; else if (p.x > WIDTH + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = HEIGHT + p.r; else if (p.y > HEIGHT + p.r) p.y = -p.r;
        if (p.shieldTimer > 0) p.shieldTimer--;
        if (p.tripleTimer > 0) p.tripleTimer--;
        if (p.speedTimer > 0) p.speedTimer--;
        for (let i = gameState.items.length - 1; i >= 0; i--) {
            let item = gameState.items[i];
            if (distBetweenPoints(p.x, p.y, item.x, item.y) < p.r + item.r) {
                if (item.type === 'SHIELD') p.shieldTimer = 10 * FPS;
                if (item.type === 'TRIPLE') p.tripleTimer = 10 * FPS;
                if (item.type === 'SPEED')  p.speedTimer = 10 * FPS;
                gameState.items.splice(i, 1);
            }
        }
    }
    for (let r of gameState.roids) {
        r.x += r.xv; r.y += r.yv; r.a += r.rot;
        if (r.x < -r.r) r.x = WIDTH + r.r; else if (r.x > WIDTH + r.r) r.x = -r.r;
        if (r.y < -r.r) r.y = HEIGHT + r.r; else if (r.y > HEIGHT + r.r) r.y = -r.r;
    }
    for (let i = gameState.lasers.length - 1; i >= 0; i--) {
        let l = gameState.lasers[i];
        l.x += l.xv; l.y += l.yv;
        if (l.x < 0 || l.x > WIDTH || l.y < 0 || l.y > HEIGHT) { gameState.lasers.splice(i, 1); continue; }
        for (let id in gameState.players) {
            let p = gameState.players[id];
            if (l.owner !== id && distBetweenPoints(l.x, l.y, p.x, p.y) < p.r) {
                if (!(p.shieldTimer > 0)) p.hp -= 10;
                gameState.lasers.splice(i, 1);
                if (p.hp <= 0) {
                    isGameOver = true;
                    let killer = gameState.players[l.owner];
                    io.emit('gameOver', { winnerName: killer ? killer.name : 'Vácuo', winnerColor: killer ? killer.color : '#fff' });
                    setTimeout(() => {
                        for (let pid in gameState.players) {
                            let pl = gameState.players[pid];
                            pl.hp = 100; pl.x = Math.random()*WIDTH; pl.y = Math.random()*HEIGHT; pl.thrust = {x:0,y:0}; pl.shieldTimer=0; pl.tripleTimer=0; pl.speedTimer=0;
                        }
                        gameState.lasers = []; gameState.items = []; spawnAsteroids(); isGameOver = false; io.emit('gameRestart');
                    }, 4000);
                }
                break;
            }
        }
    }
    io.emit('gameState', gameState);
}, 1000 / FPS);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Arena Mobile rodando na porta ${port}`));
