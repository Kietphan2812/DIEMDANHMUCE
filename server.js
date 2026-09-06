const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const PORT = process.env.PORT || 5252;
const DATABASE_URL = process.env.DATABASE_URL;

const DATA_DIR = path.join(__dirname, 'App_Data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

// Khởi tạo PostgreSQL Pool nếu có DATABASE_URL
let pool = null;
if (DATABASE_URL) {
    console.log('Đang kết nối tới PostgreSQL Database...');
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
    });

    // Tạo bảng tự động nếu chưa tồn tại
    const initDbSql = `
        CREATE TABLE IF NOT EXISTS activities (
            code VARCHAR(100) PRIMARY KEY,
            title TEXT,
            description TEXT,
            location_address TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            radius_meters INT,
            start_time TEXT,
            end_time TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS checkins (
            id SERIAL PRIMARY KEY,
            timestamp TEXT,
            code VARCHAR(100),
            title TEXT,
            student_code VARCHAR(50),
            name TEXT,
            class_name TEXT,
            faculty TEXT,
            phone_number TEXT,
            email TEXT,
            coords TEXT,
            distance TEXT,
            device TEXT,
            ip TEXT,
            device_uuid TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    pool.query(initDbSql)
        .then(() => console.log('✅ Khởi tạo PostgreSQL Database (Bảng activities & checkins) thành công!'))
        .catch(err => console.error('❌ Lỗi khởi tạo PostgreSQL Tables:', err));
} else {
    console.log('ℹ️ Không tìm thấy DATABASE_URL, đang chạy chế độ lưu file JSON nội bộ.');
}

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

// Helpers lấy dữ liệu sự kiện
async function dbGetActivities() {
    if (pool) {
        try {
            const res = await pool.query('SELECT code, title, description, location_address as "locationAddress", latitude, longitude, radius_meters as "radiusMeters", start_time as "startTime", end_time as "endTime" FROM activities ORDER BY created_at DESC');
            return res.rows;
        } catch (e) {
            console.error('Lỗi đọc activities từ SQL:', e);
        }
    }
    if (fs.existsSync(ACTIVITIES_FILE)) {
        try { return JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf8')); } catch (e) {}
    }
    return [];
}

async function dbSaveActivities(activitiesList) {
    if (pool) {
        try {
            for (const act of activitiesList) {
                if (!act || !act.code) continue;
                await pool.query(`
                    INSERT INTO activities (code, title, description, location_address, latitude, longitude, radius_meters, start_time, end_time)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (code) DO UPDATE SET
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        location_address = EXCLUDED.location_address,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        radius_meters = EXCLUDED.radius_meters,
                        start_time = EXCLUDED.start_time,
                        end_time = EXCLUDED.end_time;
                `, [
                    act.code, act.title || '', act.description || '', act.locationAddress || '',
                    parseFloat(act.latitude) || 0, parseFloat(act.longitude) || 0,
                    parseInt(act.radiusMeters) || 50, act.startTime || '', act.endTime || ''
                ]);
            }
            return true;
        } catch (e) {
            console.error('Lỗi ghi activities vào SQL:', e);
        }
    }
    fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(activitiesList, null, 2), 'utf8');
    return true;
}

// Helpers lấy dữ liệu điểm danh
async function dbGetCheckins() {
    if (pool) {
        try {
            const res = await pool.query('SELECT timestamp, code, title, student_code as "studentCode", name, class_name as "className", faculty, phone_number as "phoneNumber", email, coords, distance, device, ip, device_uuid as "deviceUuid" FROM checkins ORDER BY id DESC');
            return res.rows;
        } catch (e) {
            console.error('Lỗi đọc checkins từ SQL:', e);
        }
    }
    if (fs.existsSync(RECORDS_FILE)) {
        try { return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) {}
    }
    return [];
}

async function dbSaveCheckin(record) {
    if (pool) {
        try {
            await pool.query(`
                INSERT INTO checkins (timestamp, code, title, student_code, name, class_name, faculty, phone_number, email, coords, distance, device, ip, device_uuid)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
            `, [
                record.timestamp || new Date().toLocaleString('vi-VN'),
                record.code || '', record.title || '', record.studentCode || '',
                record.name || '', record.className || '', record.faculty || '',
                record.phoneNumber || '', record.email || '', record.coords || '',
                record.distance || '', record.device || '', record.ip || '', record.deviceUuid || ''
            ]);
            return true;
        } catch (e) {
            console.error('Lỗi ghi checkin vào SQL:', e);
        }
    }
    let list = [];
    if (fs.existsSync(RECORDS_FILE)) {
        try { list = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) {}
    }
    list.unshift(record);
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(list, null, 2), 'utf8');
    return true;
}

const server = http.createServer(async (req, res) => {
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
        res.end(JSON.stringify({ localIp: getLocalIp(), port: PORT, hasDatabase: !!pool }));
        return;
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
        const action = parsedUrl.searchParams.get('action') || '';

        if (req.method === 'GET') {
            if (action === 'getActivities' || pathname === '/api/activities') {
                const list = await dbGetActivities();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(list));
                return;
            }

            if (action === 'saveActivities') {
                const dataStr = parsedUrl.searchParams.get('data') || '[]';
                try {
                    const parsed = JSON.parse(dataStr);
                    await dbSaveActivities(parsed);
                } catch (e) {}
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                return;
            }

            if (action === 'getRecords' || pathname === '/api/records') {
                const list = await dbGetCheckins();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(list));
                return;
            }

            if (action === 'exportCsv' || pathname === '/api/export-csv') {
                let csv = '\uFEFFSTT,Thời Gian,Mã Sự Kiện,MSSV,Họ và Tên,Lớp,Khoa,Khoảng Cách,Thiết Bị,Tọa độ sự kiện,Số Điện Thoại,Gmail,Tên Sự Kiện,IP Máy\r\n';
                const list = await dbGetCheckins();
                list.forEach((item, idx) => {
                    const val = (k) => item[k] || '';
                    csv += `${idx + 1},"${val('timestamp')}","${val('code')}","${val('studentCode')}","${val('name')}","${val('className')}","${val('faculty')}","${val('distance')}","${val('device')}","${val('coords')}","${val('phoneNumber')}","${val('email')}","${val('title')}","${val('ip')}"\r\n`;
                });
                res.writeHead(200, {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="Danh_Sach_Diem_Danh_${Date.now()}.csv"`
                });
                res.end(csv);
                return;
            }

            // Mặc định GET /api trả về danh sách bản ghi
            const list = await dbGetCheckins();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(list));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    if (body.trim().startsWith('[')) {
                        const parsed = JSON.parse(body);
                        await dbSaveActivities(parsed);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                        return;
                    }

                    const json = JSON.parse(body);
                    if (json.action === 'saveActivities') {
                        const toSave = Array.isArray(json) ? json : (json.activities || []);
                        await dbSaveActivities(toSave);
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ status: 'success', message: 'Đã lưu danh sách sự kiện' }));
                        return;
                    }

                    // Điểm danh sinh viên
                    if (!json.timestamp) {
                        json.timestamp = new Date().toLocaleString('vi-VN');
                    }
                    await dbSaveCheckin(json);

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
    console.log('Web Server backend GPS Attendance (Node.js + PostgreSQL) đang chạy!');
    console.log(`- Truy cập trên máy tính: http://localhost:${PORT}`);
    console.log(`- Truy cập từ điện thoại (cùng Wi-Fi): http://${localIp}:${PORT}`);
    console.log('==================================================================');
});
