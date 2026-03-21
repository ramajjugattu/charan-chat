const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));
app.use(session({ secret: 'charan-secret-key', resave: false, saveUninitialized: false }));

const USERS_FILE = './data/users.json';
const MSG_FILE = './data/messages.json';
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
if (!fs.existsSync(MSG_FILE)) fs.writeFileSync(MSG_FILE, JSON.stringify([]));

const getData = (file) => JSON.parse(fs.readFileSync(file));
const saveData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    let users = getData(USERS_FILE);
    if (users.find(u => u.username === username)) return res.send("User already exists!");
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword, friends: [], requests: [] });
    saveData(USERS_FILE, users);
    res.redirect('/login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = getData(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = username;
        return res.redirect('/chat.html');
    }
    res.send("Invalid credentials. <a href='/login'>Try again</a>");
});

app.get('/api/me', (req, res) => {
    const user = getData(USERS_FILE).find(u => u.username === req.session.user);
    user ? res.json(user) : res.status(401).send("Unauthorized");
});

app.get('/api/users', (req, res) => {
    const allUsers = getData(USERS_FILE);
    const me = allUsers.find(u => u.username === req.session.user);
    if (!me) return res.status(401).send("Unauthorized");
    const available = allUsers.filter(u => u.username !== me.username && !me.friends.includes(u.username) && !u.requests.includes(me.username));
    res.json(available.map(u => u.username));
});

app.post('/api/send-request', (req, res) => {
    const { targetName } = req.body;
    const sender = req.session.user;
    let users = getData(USERS_FILE);
    let target = users.find(u => u.username === targetName);
    if (target && sender !== targetName && !target.requests.includes(sender)) {
        target.requests.push(sender);
        saveData(USERS_FILE, users);
        res.send("Sent");
    } else { res.status(400).send("Error"); }
});

app.post('/api/accept-request', (req, res) => {
    const { requesterName } = req.body;
    const myName = req.session.user;
    let users = getData(USERS_FILE);
    let me = users.find(u => u.username === myName);
    let requester = users.find(u => u.username === requesterName);
    if (me && requester) {
        me.requests = me.requests.filter(r => r !== requesterName);
        if (!me.friends.includes(requesterName)) me.friends.push(requesterName);
        if (!requester.friends.includes(myName)) requester.friends.push(myName);
        saveData(USERS_FILE, users);
        res.send("Accepted");
    }
});

app.post('/api/delete-friend', (req, res) => {
    const { friendName } = req.body;
    const myName = req.session.user;
    let users = getData(USERS_FILE);
    let me = users.find(u => u.username === myName);
    let friend = users.find(u => u.username === friendName);
    if (me && friend) {
        me.friends = me.friends.filter(f => f !== friendName);
        friend.friends = friend.friends.filter(f => f !== myName);
        saveData(USERS_FILE, users);
        res.send("Deleted");
    }
});

app.post('/api/delete-message', (req, res) => {
    const { msgId } = req.body;
    let messages = getData(MSG_FILE);
    const updated = messages.filter(m => m.id !== msgId);
    saveData(MSG_FILE, updated);
    res.send("Deleted");
});

app.post('/api/delete-entire-chat', (req, res) => {
    const { roomID } = req.body;
    let messages = getData(MSG_FILE);
    const filtered = messages.filter(m => m.room !== roomID);
    saveData(MSG_FILE, filtered);
    res.send("Cleared");
});

app.get('/api/messages', (req, res) => res.json(getData(MSG_FILE)));

io.on('connection', (socket) => {
    socket.on('join room', ({ roomID }) => socket.join(roomID));
    socket.on('private message', (data) => {
        const roomID = [data.from, data.to].sort().join('_');
        const newMessage = { 
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            from: data.from, to: data.to, text: data.text || "", 
            image: data.image || null, room: roomID, 
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
        };
        let messages = getData(MSG_FILE);
        messages.push(newMessage);
        saveData(MSG_FILE, messages);
        io.to(roomID).emit('new message', newMessage);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Charan Chat is live on port ${PORT}`);
});