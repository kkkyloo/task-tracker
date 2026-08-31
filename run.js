const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'tasks.json');

// Проверка и инициализация базы данных
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ tasks: [], work: {} }, null, 2));
}

const server = http.createServer((req, res) => {
    // API: Получение данных
    if (req.url === '/api/data' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(fs.readFileSync(DB_FILE));
    }
    // API: Сохранение данных
    if (req.url === '/api/data' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => { 
            fs.writeFileSync(DB_FILE, body); 
            res.end('ok'); 
        });
        return;
    }

    // Раздача статики (HTML, CSS)
    let filePath = req.url === '/' ? './index.html' : `.${req.url}`;
    const ext = path.extname(filePath);
    const contentType = ext === '.css' ? 'text/css' : 'text/html';

    if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(fs.readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end('404 Not Found');
    }
});

server.listen(PORT, () => {
    console.log('\x1b[32m%s\x1b[0m', `🚀 Дашборд запущен: http://localhost:${PORT}`);
    console.log('\x1b[36m%s\x1b[0m', `💾 Данные сохраняются в: tasks.json`);
});