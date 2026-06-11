const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve a pasta "public" onde fica o seu index.html
app.use(express.static('public'));

const FPS = 60;
const FRICTION = 0.97;
const TURN_SPEED = 240;
const LASER_SPD = 750;
const WIDTH = 1200; // Tamanho fixo do universo no servidor
const HEIGHT = 800;

let gameState = {
    players: {},
    lasers: [],
    roids: [],
    items: [] 
};

// Gera os asteroides iniciais no mapa do servidor
for (let i = 0; i < 5; i++) {
    gameState.roids.push({
        x: Math.random() * WIDTH, 
        y: Math.random() * HEIGHT, 
        r: 45,
        xv: (Math.random() * 100 / FPS) * (Math.random() < 0.5 ? 1 : -1),
        yv: (Math.random() * 100 / FPS) * (Math.random() < 0.5 ? 1 : -1),
        a: Math.random() * Math.PI * 2,
        rot: (Math.random() * 8 / FPS) * (Math.random() < 0.5 ? 1 : -1),
        vert: Math.floor(Math.random() * 5 + 7),
        offs: Array.from({length: 12}, () => Math.random() * 0.3 * 2 + 0.85)
    });
}

io.on('connection', (socket) => {
    console.log('Piloto conectado:', socket.id);

    // Evento de ping para o cliente calcular a latência (ms)
    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('joinGame', (data) => {
        gameState.players[socket.id] = {
            id: socket.id,
            name: data.name,
            color: data.color,
            x: Math.random() * WIDTH,
            y: Math.random() * HEIGHT,
            r: 18, 
            a: Math.PI / 2, // Apontando para cima inicialmente
            rot: 0,
            thrusting: false, 
            thrust: { x: 0, y: 0 },
            hp: 100, 
            lastShot: 0,
            shieldTimer: 0, 
            tripleTimer: 0,
            speedTimer: 0
        };
    });

    socket.on('playerInput', (keys) => {
        let p = gameState.players[socket.id];
        if (!p) return;

        p.rot = 0;
        if (keys.left) p.rot = TURN_SPEED / 180 * Math.PI / FPS;
        if (keys.right) p.rot = -TURN_SPEED / 180 * Math.PI / FPS;
        p.thrusting = keys.up;

        // Controle de tiro (Cooldown de 250ms)
        if (keys.shoot && Date.now() - p.lastShot > 250) {
            gameState.lasers.push({
                x: p.x + 4/3 * p.r * Math.cos(p.a),
                y: p.y - 4/3 * p.r * Math.sin(p.a),
                xv: LASER_SPD * Math.cos(p.a) / FPS,
                yv: -LASER_SPD * Math.sin(p.a) / FPS,
                owner: socket.id, 
                r: 3
            });
            p.lastShot = Date.now();
        }
    });

    socket.on('disconnect', () => {
        console.log('Piloto desconectado:', socket.id);
        delete gameState.players[socket.id];
    });
});

function distBetweenPoints(x1, y1, x2, y2) { 
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)); 
}

// Loop Principal do Jogo (60 ticks por segundo)
setInterval(() => {
    // 1. Física dos Jogadores
    for (let id in gameState.players) {
        let p = gameState.players[id];
        
        if (p.thrusting) {
            let accel = p.speedTimer > 0 ? 20 : 12; 
            p.thrust.x += accel * Math.cos(p.a) / FPS;
            p.thrust.y -= accel * Math.sin(p.a) / FPS;
        } else {
            p.thrust.x *= FRICTION;
            p.thrust.y *= FRICTION;
        }
        
        p.a += p.rot;
        p.x += p.thrust.x;
        p.y += p.thrust.y;

        // Limites do Universo (Efeito Pacman / Wrap)
        if (p.x < -p.r) p.x = WIDTH + p.r;
        if (p.x > WIDTH + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = HEIGHT + p.r;
        if (p.y > HEIGHT + p.r) p.y = -p.r;

        if (p.shieldTimer > 0) p.shieldTimer--;
        if (p.tripleTimer > 0) p.tripleTimer--;
        if (p.speedTimer > 0) p.speedTimer--;
    }

    // 2. Física dos Asteroides
    for (let r of gameState.roids) {
        r.x += r.xv; 
        r.y += r.yv; 
        r.a += r.rot;
        
        if (r.x < -r.r) r.x = WIDTH + r.r;
        if (r.x > WIDTH + r.r) r.x = -r.r;
        if (r.y < -r.r) r.y = HEIGHT + r.r;
        if (r.y > HEIGHT + r.r) r.y = -r.r;
    }

    // 3. Física dos Lasers e Colisões
    for (let i = gameState.lasers.length - 1; i >= 0; i--) {
        let l = gameState.lasers[i];
        l.x += l.xv; 
        l.y += l.yv;

        // Remove lasers fora do mapa
        if (l.x < 0 || l.x > WIDTH || l.y < 0 || l.y > HEIGHT) {
            gameState.lasers.splice(i, 1); 
            continue;
        }

        let laserDestroyed = false;
        
        // Colisão do Laser com Asteroides
        for (let r of gameState.roids) {
            if (distBetweenPoints(l.x, l.y, r.x, r.y) < r.r) {
                gameState.lasers.splice(i, 1);
                laserDestroyed = true;
                break;
            }
        }
        if (laserDestroyed) continue;

        // Colisão do Laser com Outros Jogadores
        for (let id in gameState.players) {
            let p = gameState.players[id];
            
            if (l.owner !== id && distBetweenPoints(l.x, l.y, p.x, p.y) < p.r) {
                if (!(p.shieldTimer > 0)) {
                    p.hp -= 10;
                }
                
                gameState.lasers.splice(i, 1);
                
                // Sistema de Respawn se o jogador morrer
                if (p.hp <= 0) {
                    p.x = Math.random() * WIDTH;
                    p.y = Math.random() * HEIGHT;
                    p.thrust = { x: 0, y: 0 };
                    p.hp = 100;
                }
                break;
            }
        }
    }

    // Dispara o estado atualizado do universo para todos os clientes
    io.emit('gameState', gameState);

}, 1000 / FPS);

// Inicialização do Servidor com a Porta Dinâmica do Render
const port = process.env.PORT || 3000;

server.listen(port, () => {
    console.log(`[SERVER] Arena Multiplayer online iniciada com sucesso na porta ${port}`);
});
