const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 5252;
const DATA_DIR = path.join(__dirname, 'App_Data');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let pathname = parsedUrl.pathname;

    // SPA Rewrite
    if (pathname.startsWith('/Activity/CheckIn/') || pathname.startsWith('/checkin/')) {
        pathname = '/checkin.html';
    }

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // API Routes
    if (pathname === '/api/server-info') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ localIp: getLocalIp(), port: PORT }));
        return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
        const action = parsedUrl.searchParams.get('action') || '';

        if (req.method === 'GET') {
            if (action === 'getActivities' || pathname === '/api/activities') {
                const data = fs.existsSync(ACTIVITIES_FILE) ? fs.readFileSync(ACTIVITIES_FILE, 'utf8') : '[]';
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(data);
                return;
            }

            if (action === 'saveActivities') {
                const data = parsedUrl.searchParams.get('data') || '[]';
                fs.writeFileSync(ACTIVITIES_FILE, data, 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                return;
            }

            if (action === 'getRecords' || pathname === '/api/records') {
                const data = fs.existsSync(RECORDS_FILE) ? fs.readFileSync(RECORDS_FILE, 'utf8') : '[]';
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(data);
                return;
            }

            if (action === 'exportCsv' || pathname === '/api/export-csv') {
                let csv = '\uFEFFSTT,Thời Gian,Mã Sự Kiện,MSSV,Họ và Tên,Lớp,Khoa,Khoảng Cách,Thiết Bị,Tọa độ sự kiện,Số Điện Thoại,Gmail,Tên Sự Kiện,IP Máy\r\n';
                if (fs.existsSync(RECORDS_FILE)) {
                    try {
                        const list = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
                        list.forEach((item, idx) => {
                            const val = (k) => item[k] || '';
                            csv += `${idx + 1},"${val('timestamp')}","${val('code')}","${val('studentCode')}","${val('name')}","${val('className')}","${val('faculty')}","${val('distance')}","${val('device')}","${val('coords')}","${val('phoneNumber')}","${val('email')}","${val('title')}","${val('ip')}"\r\n`;
                        });
                    } catch (e) {}
                }
                res.writeHead(200, {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="Danh_Sach_Diem_Danh_${Date.now()}.csv"`
                });
                res.end(csv);
                return;
            }

            // Mặc định GET /api trả về danh sách bản ghi
            const data = fs.existsSync(RECORDS_FILE) ? fs.readFileSync(RECORDS_FILE, 'utf8') : '[]';
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(data);
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    if (body.trim().startsWith('[')) {
                        fs.writeFileSync(ACTIVITIES_FILE, body, 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                        return;
                    }

                    const json = JSON.parse(body);
                    if (json.action === 'saveActivities') {
                        const toSave = Array.isArray(json) ? json : (json.activities || []);
                        fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(toSave, null, 2), 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                        return;
                    }

                    // Điểm danh sinh viên
                    if (!json.timestamp) {
                        json.timestamp = new Date().toLocaleString('vi-VN');
                    }
                    let list = [];
                    if (fs.existsSync(RECORDS_FILE)) {
                        try { list = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) {}
                    }
                    list.unshift(json);
                    fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2), 'utf8');

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ status: 'success', message: 'Điểm danh thành công!' }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ status: 'error', message: err.toString() }));
                }
            });
            return;
        }
    }

    // File Tĩnh
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log('==================================================================');
    console.log('Web Server backend GPS Attendance (Node.js) đang chạy!');
    console.log(`- Truy cập trên máy tính: http://localhost:${PORT}`);
    console.log(`- Truy cập từ điện thoại (cùng Wi-Fi): http://${localIp}:${PORT}`);
    console.log('==================================================================');
});
