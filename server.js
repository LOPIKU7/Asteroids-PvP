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
const LASER_SPD = 850; // Deixei o tiro ligeiramente mais rápido para o Full HD
const WIDTH = 1920;    // Resolução Full HD (Largura)
const HEIGHT = 1080;   // Resolução Full HD (Altura)

let gameState = { players: {}, lasers: [], roids: [], items: [] };
let isGameOver = false; 

// Função para gerar Asteroides
function spawnAsteroids() {
    gameState.roids = [];
    for (let i = 0; i < 8; i++) { // Aumentado para 8 por causa do mapa maior
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

// Função para spawnar Power-Ups no mapa
setInterval(() => {
    if (!isGameOver && gameState.items.length < 4) { // Máximo de 4 itens soltos na arena
        const types = ['TRIPLE', 'SHIELD', 'SPEED'];
        gameState.items.push({
            x: Math.random() * WIDTH,
            y: Math.random() * HEIGHT,
            r: 20,
            type: types[Math.floor(Math.random() * types.length)]
        });
    }
}, 8000); // Tenta nascer um novo item a cada 8 segundos

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
        if (isGameOver) return; 
        
        let p = gameState.players[socket.id];
        if (!p) return;

        p.rot = 0;
        if (keys.left) p.rot = TURN_SPEED / 180 * Math.PI / FPS;
        if (keys.right) p.rot = -TURN_SPEED / 180 * Math.PI / FPS;
        p.thrusting = keys.up;

        // Atirando
        if (keys.shoot && Date.now() - p.lastShot > 250) {
            let speed = LASER_SPD / FPS;
            let baseData = { owner: socket.id, r: 4 };

            // Tiro Central (Sempre sai)
            gameState.lasers.push({
                x: p.x + 4/3 * p.r * Math.cos(p.a), y: p.y - 4/3 * p.r * Math.sin(p.a),
                xv: speed * Math.cos(p.a), yv: -speed * Math.sin(p.a), ...baseData
            });

            // Se tiver buff Triplo, solta os das laterais em angulos (aprox 14 graus)
            if (p.tripleTimer > 0) {
                let ang1 = p.a + 0.25;
                let ang2 = p.a - 0.25;
                gameState.lasers.push({
                    x: p.x + 4/3 * p.r * Math.cos(p.a), y: p.y - 4/3 * p.r * Math.sin(p.a),
                    xv: speed * Math.cos(ang1), yv: -speed * Math.sin(ang1), ...baseData
                });
                gameState.lasers.push({
                    x: p.x + 4/3 * p.r * Math.cos(p.a), y: p.y - 4/3 * p.r * Math.sin(p.a),
                    xv: speed * Math.cos(ang2), yv: -speed * Math.sin(ang2), ...baseData
                });
            }
            p.lastShot = Date.now();
        }
    });

    socket.on('disconnect', () => { delete gameState.players[socket.id]; });
});

function distBetweenPoints(x1, y1, x2, y2) { 
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)); 
}

setInterval(() => {
    if (isGameOver) {
        io.emit('gameState', gameState);
        return;
    }

    for (let id in gameState.players) {
        let p = gameState.players[id];
        
        // Lógica de Velocidade (+ Velocidade se tiver buff)
        if (p.thrusting) {
            let accel = p.speedTimer > 0 ? 25 : 12; // 25 = Muito mais rápido
            p.thrust.x += accel * Math.cos(p.a) / FPS;
            p.thrust.y -= accel * Math.sin(p.a) / FPS;
        } else {
            p.thrust.x *= FRICTION; p.thrust.y *= FRICTION;
        }
        p.a += p.rot; p.x += p.thrust.x; p.y += p.thrust.y;

        // Wrap do Mapa (Pacman)
        if (p.x < -p.r) p.x = WIDTH + p.r; else if (p.x > WIDTH + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = HEIGHT + p.r; else if (p.y > HEIGHT + p.r) p.y = -p.r;

        // Desconta 1 frame dos buffs
        if (p.shieldTimer > 0) p.shieldTimer--;
        if (p.tripleTimer > 0) p.tripleTimer--;
        if (p.speedTimer > 0) p.speedTimer--;

        // Coleta de Power-Ups
        for (let i = gameState.items.length - 1; i >= 0; i--) {
            let item = gameState.items[i];
            if (distBetweenPoints(p.x, p.y, item.x, item.y) < p.r + item.r) {
                // Ganha o poder equivalente a 10 segundos (10 * 60 FPS)
                if (item.type === 'SHIELD') p.shieldTimer = 10 * FPS;
                if (item.type === 'TRIPLE') p.tripleTimer = 10 * FPS;
                if (item.type === 'SPEED')  p.speedTimer = 10 * FPS;
                gameState.items.splice(i, 1);
            }
        }
    }

    // Física dos asteroides
    for (let r of gameState.roids) {
        r.x += r.xv; r.y += r.yv; r.a += r.rot;
        if (r.x < -r.r) r.x = WIDTH + r.r; else if (r.x > WIDTH + r.r) r.x = -r.r;
        if (r.y < -r.r) r.y = HEIGHT + r.r; else if (r.y > HEIGHT + r.r) r.y = -r.r;
    }

    // Física dos lasers e Colisão
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
                // Se tiver de escudo, não toma dano
                if (!(p.shieldTimer > 0)) p.hp -= 10;
                gameState.lasers.splice(i, 1);
                
                // Morte e Vitória
                if (p.hp <= 0) {
                    isGameOver = true;
                    let killer = gameState.players[l.owner];
                    
                    io.emit('gameOver', { 
                        winnerName: killer ? killer.name : 'O Vácuo',
                        winnerColor: killer ? killer.color : '#fff'
                    });

                    setTimeout(() => {
                        for (let pid in gameState.players) {
                            gameState.players[pid].hp = 100;
                            gameState.players[pid].x = Math.random() * WIDTH;
                            gameState.players[pid].y = Math.random() * HEIGHT;
                            gameState.players[pid].thrust = { x: 0, y: 0 };
                            gameState.players[pid].shieldTimer = 0;
                            gameState.players[pid].tripleTimer = 0;
                            gameState.players[pid].speedTimer = 0;
                        }
                        gameState.lasers = [];
                        gameState.items = []; // Limpa os itens soltos no chão
                        spawnAsteroids(); 
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
    console.log(`[SERVER] Arena Full HD 1v1 rodando na porta ${port}`);
});
