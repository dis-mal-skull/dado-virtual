/* Dado Virtual - app principal
   Three.js + cannon.js : dado 3D con físicas reales */

var DIE_SIZE = 1.0;
var DICE_TYPES = [
    { id: 'd4', label: 'D4', faces: 4, rpg: true },
    { id: 'd6', label: 'D6', faces: 6, rpg: false },
    { id: 'd8', label: 'D8', faces: 8, rpg: true },
    { id: 'd10', label: 'D10', faces: 10, rpg: true },
    { id: 'd12', label: 'D12', faces: 12, rpg: true },
    { id: 'd20', label: 'D20', faces: 20, rpg: true }
];

var COLORS = ['#e63946', '#2a9d8f', '#457b9d', '#f4a261', '#9b5de5', '#ffffff', '#2b2d42', '#7fbf7f'];

var PIPS = {
    1: [[0, 0]],
    2: [[-0.3, 0.3], [0.3, -0.3]],
    3: [[-0.3, 0.3], [0, 0], [0.3, -0.3]],
    4: [[-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]],
    5: [[-0.3, 0.3], [0.3, 0.3], [0, 0], [-0.3, -0.3], [0.3, -0.3]],
    6: [[-0.3, 0.3], [0.3, 0.3], [-0.3, 0], [0.3, 0], [-0.3, -0.3], [0.3, -0.3]]
};

/* ---------- Estado ---------- */
var settings = loadSettings();
var history = [];
var totalRolls = 0;
var dieType = 'd6';
var rolling = false;

function loadSettings() {
    var s = { color: '#e63946', vibrate: true, sound: true, shake: true, two: false, theme: 'dark' };
    try {
        var raw = localStorage.getItem('dv_settings');
        if (raw) s = Object.assign(s, JSON.parse(raw));
    } catch (e) {}
    return s;
}
function saveSettings() {
    try { localStorage.setItem('dv_settings', JSON.stringify(settings)); } catch (e) {}
}
function loadHistory() {
    try {
        var raw = localStorage.getItem('dv_history');
        if (raw) history = JSON.parse(raw);
    } catch (e) {}
    history = history.slice(0, 50);
}
function saveHistory() {
    try { localStorage.setItem('dv_history', JSON.stringify(history.slice(0, 50))); } catch (e) {}
}
function loadTotal() {
    try {
        var raw = localStorage.getItem('dv_total');
        if (raw) totalRolls = parseInt(raw, 10) || 0;
    } catch (e) {}
}
function saveTotal() {
    try { localStorage.setItem('dv_total', String(totalRolls)); } catch (e) {}
}
function loadStats() {
    try {
        var raw = localStorage.getItem('dv_stats_' + dieType);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
}
function saveStats(stats) {
    try { localStorage.setItem('dv_stats_' + dieType, JSON.stringify(stats)); } catch (e) {}
}

/* ---------- Escena Three.js ---------- */
var container = document.getElementById('scene-container');
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3.5, 4.2, 6.5);
camera.lookAt(0, 0.3, 0);

var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

var ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
var dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(6, 12, 8);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);
var backLight = new THREE.DirectionalLight(0x88aaff, 0.3);
backLight.position.set(-5, 4, -6);
scene.add(backLight);

var tableMat = new THREE.MeshStandardMaterial({ color: 0x7a5a2e, roughness: 0.7, metalness: 0.1 });
var table = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 8), tableMat);
table.position.y = -0.3;
table.receiveShadow = true;
scene.add(table);

var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.55;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- Mundo cannon.js ---------- */
var world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;

var dieMaterial = new CANNON.Material('die');
var tableMaterial = new CANNON.Material('table');
var contact = new CANNON.ContactMaterial(dieMaterial, tableMaterial, { friction: 0.2, restitution: 0.35 });
world.addContactMaterial(contact);

var tableBody = new CANNON.Body({ mass: 0, material: tableMaterial });
tableBody.addShape(new CANNON.Box(new CANNON.Vec3(4, 0.25, 4)));
tableBody.position.y = -0.3;
world.addBody(tableBody);

var activeDice = [];

function resetWorld() {
    for (var i = 0; i < activeDice.length; i++) {
        var d = activeDice[i];
        scene.remove(d.mesh);
        if (d.pips) d.pips.forEach(function (p) { scene.remove(p); });
        world.removeBody(d.body);
    }
    activeDice = [];
}

/* ---------- Utilidades de geometría ---------- */
function subV(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function crossV(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dotV(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function lenV(a) { return Math.sqrt(dotV(a, a)); }
function normV(a) { var l = lenV(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; }

function faceNormal(verts, face) {
    var a = verts[face[0]], b = verts[face[1]], c = verts[face[2]];
    return normV(crossV(subV(b, a), subV(c, a)));
}

function centroid(verts) {
    var c = [0, 0, 0];
    for (var i = 0; i < verts.length; i++) {
        c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2];
    }
    return [c[0] / verts.length, c[1] / verts.length, c[2] / verts.length];
}

function orderPolygon(face, normal, verts) {
    var cent = centroid(face.map(function (i) { return verts[i]; }));
    var ref = normV(subV(verts[face[0]], cent));
    var orth = normV(crossV(normal, ref));
    var sorted = face.slice().sort(function (a, b) {
        var va = subV(verts[a], cent), vb = subV(verts[b], cent);
        var angA = Math.atan2(dotV(va, orth), dotV(va, ref));
        var angB = Math.atan2(dotV(vb, orth), dotV(vb, ref));
        return angA - angB;
    });
    return sorted;
}

/* Poliedros regulares: de THREE.Geometry agrupamos triángulos por normal para obtener caras */
function polyhedronFaces(geometry) {
    var verts = geometry.vertices.map(function (v) { return [v.x, v.y, v.z]; });
    var tris = geometry.faces.map(function (f) {
        return { idx: [f.a, f.b, f.c], n: faceNormal(verts, [f.a, f.b, f.c]) };
    });
    var used = new Array(tris.length).fill(false);
    var polys = [];
    for (var i = 0; i < tris.length; i++) {
        if (used[i]) continue;
        var set = new Set();
        var base = tris[i].n;
        for (var j = 0; j < tris.length; j++) {
            if (used[j]) continue;
            if (dotV(base, tris[j].n) > 0.95) {
                used[j] = true;
                set.add(tris[j].idx[0]); set.add(tris[j].idx[1]); set.add(tris[j].idx[2]);
            }
        }
        polys.push({ idx: Array.from(set) });
    }
    var remap = {};
    var vlist = [];
    polys.forEach(function (p) {
        p.idx = p.idx.map(function (oi) {
            if (remap[oi] === undefined) { remap[oi] = vlist.length; vlist.push(verts[oi]); }
            return remap[oi];
        });
    });
    return { vertices: vlist, faces: polys.map(function (p) { return p.idx; }) };
}

/* d10: bipirámide pentagonal (10 caras triangulares) */
function decahedron() {
    var verts = [];
    var top = 1.4, r = 1.0;
    verts.push([0, top, 0]);
    verts.push([0, -top, 0]);
    for (var k = 0; k < 5; k++) {
        var a = 2 * Math.PI * k / 5;
        verts.push([r * Math.cos(a), 0, r * Math.sin(a)]);
    }
    var faces = [];
    for (var k2 = 0; k2 < 5; k2++) {
        var e1 = 2 + k2, e2 = 2 + ((k2 + 1) % 5);
        faces.push([0, e1, e2]);       // cara superior
        faces.push([1, e2, e1]);       // cara inferior
    }
    return { vertices: verts, faces: faces };
}

function orientFacesOutward(verts, faces) {
    var c = centroid(verts);
    return faces.map(function (face) {
        var n = faceNormal(verts, face);
        var fc = centroid(face.map(function (i) { return verts[i]; }));
        if (dotV(n, subV(fc, c)) < 0) {
            return face.slice().reverse();
        }
        return face;
    });
}

function buildDieGeometry(verts, faces, labels, baseColor) {
    faces = orientFacesOutward(verts, faces);
    var positions = [], uvs = [], groupStart = [], count = 0;
    for (var fi = 0; fi < faces.length; fi++) {
        var face = faces[fi];
        var triIndices = [];
        for (var t = 1; t < face.length - 1; t++) triIndices.push(face[0], face[t], face[t + 1]);
        groupStart.push(count);
        var n = faceNormal(verts, face);
        var a = verts[face[0]];
        var u = normV(subV(verts[face[1]], a));
        var v = normV(crossV(n, u));
        var pts = face.map(function (i) {
            var d = subV(verts[i], a);
            return [dotV(d, u), dotV(d, v)];
        });
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        pts.forEach(function (p) {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        });
        var sx = (maxX - minX) || 1, sy = (maxY - minY) || 1;
        var uvFor = {};
        face.forEach(function (oi, k) {
            uvFor[oi] = [(pts[k][0] - minX) / sx, (pts[k][1] - minY) / sy];
        });
        triIndices.forEach(function (oi) {
            positions.push(verts[oi][0], verts[oi][1], verts[oi][2]);
            uvs.push(uvFor[oi][0], uvFor[oi][1]);
        });
        count += triIndices.length;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    for (var g = 0; g < groupStart.length; g++) {
        var c2 = g < groupStart.length - 1 ? groupStart[g + 1] - groupStart[g] : count - groupStart[g];
        geo.addGroup(groupStart[g], c2, g);
    }
    geo.computeVertexNormals();
    return geo;
}

function numberTexture(label, baseColor) {
    var s = 256;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + Math.floor(s * 0.45) + 'px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 12;
    ctx.fillText(String(label), s / 2, s / 2);
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
}

function assignOppositeLabels(normals, n) {
    var labels = new Array(n).fill(0);
    var used = new Array(n).fill(false);
    var next = 1;
    for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        labels[i] = next;
        used[i] = true;
        var found = -1;
        for (var j = 0; j < n; j++) {
            if (used[j]) continue;
            if (dotV(normals[i], normals[j]) < -0.7) { found = j; break; }
        }
        if (found !== -1) {
            labels[found] = n + 1 - next;
            used[found] = true;
        }
        next++;
    }
    for (var k = 0; k < n; k++) if (labels[k] === 0) labels[k] = next++;
    return labels;
}

/* ---------- Crear dados ---------- */
function buildRpgDie(facesData, label, colorHex) {
    var data = facesData;
    var verts = data.vertices;
    var faces = orientFacesOutward(verts, data.faces);
    var normals = faces.map(function (f) { return faceNormal(verts, f); });
    var labels = assignOppositeLabels(normals, faces.length);

    var scale = 0.9 / (lenV(verts[0]) || 1);
    var scaled = verts.map(function (v) { return [v[0] * scale, v[1] * scale, v[2] * scale]; });

    var geo = buildDieGeometry(scaled, faces, labels, colorHex);
    var mats = labels.map(function (l) {
        var tex = numberTexture(l, colorHex);
        var m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1 });
        return m;
    });
    var mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;

    var cnvVerts = scaled.map(function (v) { return new CANNON.Vec3(v[0], v[1], v[2]); });
    var hull = new CANNON.ConvexPolyhedron(cnvVerts, faces);
    var body = new CANNON.Body({ mass: 1, material: dieMaterial });
    body.addShape(hull);

    return { mesh: mesh, body: body, normals: normals, labels: labels, scale: scale };
}

function buildD6(colorHex) {
    var mesh = new THREE.Mesh(
        new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.4, metalness: 0.1 })
    );
    mesh.castShadow = true;
    var pips = [];
    var dirs = [
        { dir: [0, 1, 0], val: 1 }, { dir: [0, -1, 0], val: 6 },
        { dir: [1, 0, 0], val: 4 }, { dir: [-1, 0, 0], val: 3 },
        { dir: [0, 0, 1], val: 5 }, { dir: [0, 0, -1], val: 2 }
    ];
    var half = DIE_SIZE / 2;
    var pipMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.2 });
    var offset = 0.02;
    dirs.forEach(function (d) {
        var normal = d.dir;
        var u, v;
        if (normal[1] !== 0) { u = [1, 0, 0]; v = [0, 0, 1]; }
        else if (normal[0] !== 0) { u = [0, 0, 1]; v = [0, 1, 0]; }
        else { u = [1, 0, 0]; v = [0, 1, 0]; }
        var pos = PIPS[d.val];
        pos.forEach(function (p) {
            var px = normal[0] * (half + offset) + p[0] * u[0] * 0.7 + p[1] * v[0] * 0.7;
            var py = normal[1] * (half + offset) + p[0] * u[1] * 0.7 + p[1] * v[1] * 0.7;
            var pz = normal[2] * (half + offset) + p[0] * u[2] * 0.7 + p[1] * v[2] * 0.7;
            var sph = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), pipMat);
            sph.position.set(px, py, pz);
            mesh.add(sph);
            pips.push(sph);
        });
    });

    var body = new CANNON.Body({ mass: 1, material: dieMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.45, 0.45, 0.45)));
    var r = 0.24;
    [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
     [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]].forEach(function (s) {
        body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(s[0] * 0.5, s[1] * 0.5, s[2] * 0.5));
    });

    return { mesh: mesh, body: body, pips: pips, dirs: dirs, isD6: true };
}

function createDie() {
    var colorHex = settings.color;
    if (dieType === 'd6') return buildD6(colorHex);
    var def = DICE_TYPES.filter(function (d) { return d.id === dieType; })[0];
    var data = dieType === 'd10' ? decahedron()
        : polyhedronFaces(new THREE.TetrahedronGeometry(1, 0));
    if (dieType === 'd8') data = polyhedronFaces(new THREE.OctahedronGeometry(1, 0));
    if (dieType === 'd12') data = polyhedronFaces(new THREE.DodecahedronGeometry(1, 0));
    if (dieType === 'd20') data = polyhedronFaces(new THREE.IcosahedronGeometry(1, 0));
    return buildRpgDie(data, def.label, colorHex);
}

function getDieValue(die) {
    var up = [0, 1, 0];
    var q = die.body.quaternion;
    var best = -2, value = 0;
    if (die.isD6) {
        die.dirs.forEach(function (d) {
            var wx = d.dir[0], wy = d.dir[1], wz = d.dir[2];
            var rx = (1 - 2 * (q.y * q.y + q.z * q.z)) * wx + 2 * (q.x * q.y - q.w * q.z) * wy + 2 * (q.x * q.z + q.w * q.y) * wz;
            var ry = 2 * (q.x * q.y + q.w * q.z) * wx + (1 - 2 * (q.x * q.x + q.z * q.z)) * wy + 2 * (q.y * q.z - q.w * q.x) * wz;
            var rz = 2 * (q.x * q.z - q.w * q.y) * wx + 2 * (q.y * q.z + q.w * q.x) * wy + (1 - 2 * (q.x * q.x + q.y * q.y)) * wz;
            var dot = ry;
            if (dot > best) { best = dot; value = d.val; }
        });
    } else {
        for (var i = 0; i < die.normals.length; i++) {
            var n = die.normals[i];
            var nx = (1 - 2 * (q.y * q.y + q.z * q.z)) * n[0] + 2 * (q.x * q.y - q.w * q.z) * n[1] + 2 * (q.x * q.z + q.w * q.y) * n[2];
            var ny = 2 * (q.x * q.y + q.w * q.z) * n[0] + (1 - 2 * (q.x * q.x + q.z * q.z)) * n[1] + 2 * (q.y * q.z - q.w * q.x) * n[2];
            var nz = 2 * (q.x * q.z - q.w * q.y) * n[0] + 2 * (q.y * q.z + q.w * q.x) * n[1] + (1 - 2 * (q.x * q.x + q.y * q.y)) * n[2];
            var dot = ny;
            if (dot > best) { best = dot; value = die.labels[i]; }
        }
    }
    return value;
}

/* ---------- Sonido (Web Audio) ---------- */
var audioCtx = null;
function initAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function playSound() {
    if (!settings.sound || !audioCtx) return;
    var dur = 0.35;
    var buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    var src = audioCtx.createBufferSource();
    src.buffer = buffer;
    var filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    var gain = audioCtx.createGain();
    gain.gain.value = 0.5;
    src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    src.start();
}

function doVibrate(ms) {
    if (!settings.vibrate) return;
    try {
        if (window.Android && window.Android.vibrate) { window.Android.vibrate(ms); return; }
        if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
}

/* ---------- UI ---------- */
function initUI() {
    var diceRow = document.getElementById('diceTypes');
    DICE_TYPES.forEach(function (d) {
        var b = document.createElement('button');
        b.className = 'dice-chip' + (d.id === dieType ? ' active' : '');
        b.textContent = d.label;
        b.onclick = function () {
            dieType = d.id;
            settingsSaved = false;
            document.querySelectorAll('.dice-chip').forEach(function (c) { c.classList.remove('active'); });
            b.classList.add('active');
            rebuildColorRow();
            renderStats();
        };
        diceRow.appendChild(b);
    });

    var colorRow = document.getElementById('colorRow');
    function rebuildColorRow() {
        colorRow.innerHTML = '';
        COLORS.forEach(function (c) {
            var sw = document.createElement('span');
            sw.className = 'color-swatch' + (c === settings.color ? ' active' : '');
            sw.style.background = c;
            sw.onclick = function () {
                settings.color = c;
                saveSettings();
                document.querySelectorAll('.color-swatch').forEach(function (x) { x.classList.remove('active'); });
                sw.classList.add('active');
                rebuildDice();
            };
            colorRow.appendChild(sw);
        });
        var custom = document.createElement('input');
        custom.type = 'color';
        custom.value = settings.color;
        custom.onchange = function () {
            settings.color = custom.value;
            saveSettings();
            document.querySelectorAll('.color-swatch').forEach(function (x) { x.classList.remove('active'); });
            rebuildDice();
        };
        colorRow.appendChild(custom);
    }
    rebuildColorRow();

    document.getElementById('optVibrate').checked = settings.vibrate;
    document.getElementById('optSound').checked = settings.sound;
    document.getElementById('optShake').checked = settings.shake;
    document.getElementById('optTwo').checked = settings.two;

    document.getElementById('optVibrate').onchange = function (e) { settings.vibrate = e.target.checked; saveSettings(); };
    document.getElementById('optSound').onchange = function (e) { settings.sound = e.target.checked; saveSettings(); };
    document.getElementById('optShake').onchange = function (e) { settings.shake = e.target.checked; saveSettings(); };
    document.getElementById('optTwo').onchange = function (e) {
        settings.two = e.target.checked;
        saveSettings();
        rebuildDice();
        updateCamera();
    };

    document.getElementById('btnSettings').onclick = function () {
        document.getElementById('panel').classList.toggle('show');
    };
    document.getElementById('btnTheme').onclick = function () {
        settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
        saveSettings();
        document.body.classList.toggle('light', settings.theme === 'light');
    };
    document.getElementById('rollBtn').onclick = function () {
        initAudio();
        roll();
    };
}

var settingsSaved = false;

function rebuildDice() {
    resetWorld();
    var colorHex = settings.color;
    var d = createDie();
    d.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    d.body.position.set(0, 8, 0);
    d.body.quaternion.set(Math.random(), Math.random(), Math.random(), Math.random());
    d.body.angularVelocity.set(0, 0, 0);
    d.body.velocity.set(0, 0, 0);
    scene.add(d.mesh);
    if (d.pips) d.pips.forEach(function (p) { p.material.color.set(colorHex === '#ffffff' ? 0x222222 : 0x111111); });
    world.addBody(d.body);
    activeDice.push(d);
    if (settings.two) {
        var d2 = createDie();
        d2.body.position.set(1.2, 9, 0.3);
        d2.body.quaternion.set(Math.random(), Math.random(), Math.random(), Math.random());
        scene.add(d2.mesh);
        world.addBody(d2.body);
        activeDice.push(d2);
    }
    document.getElementById('rollBtn').classList.remove('disabled');
}

function updateCamera() {
    if (settings.two) {
        camera.position.set(4.5, 4.5, 7.5);
        camera.lookAt(0, 0.3, 0);
    } else {
        camera.position.set(3.5, 4.2, 6.5);
        camera.lookAt(0, 0.3, 0);
    }
}

function renderHistory() {
    var list = document.getElementById('historyList');
    list.innerHTML = '';
    if (history.length === 0) { list.innerHTML = '<div style="opacity:.6;font-size:13px">Sin resultados aún</div>'; return; }
    history.forEach(function (h) {
        var el = document.createElement('span');
        el.className = 'hist-item';
        el.textContent = h.values.join(' + ') + (h.double ? ' ✖2' : '');
        list.appendChild(el);
    });
}

function renderStats() {
    var stats = loadStats();
    var bars = document.getElementById('statBars');
    bars.innerHTML = '';
    var total = 0;
    Object.keys(stats).forEach(function (k) { total += stats[k]; });
    for (var v = 1; v <= DICE_TYPES.filter(function (d) { return d.id === dieType; })[0].faces; v++) {
        var cnt = stats[v] || 0;
        var pct = total > 0 ? (cnt / total * 100) : 0;
        var row = document.createElement('div');
        row.className = 'stat-bar';
        row.innerHTML = '<span class="stat-label">' + v + '</span>' +
            '<div class="stat-track"><div class="stat-fill" style="width:' + pct + '%"></div></div>' +
            '<span style="width:34px;text-align:right">' + cnt + '</span>';
        bars.appendChild(row);
    }
}

function updateHUD() {
    document.getElementById('stats').textContent = 'Tiradas: ' + totalRolls;
    document.getElementById('result').textContent = '';
}

/* ---------- Lógica de tirada ---------- */
function roll() {
    if (rolling) return;
    rolling = true;
    document.getElementById('rollBtn').classList.add('disabled');
    document.getElementById('result').textContent = '🎲';
    document.getElementById('log').textContent = '';
    playSound();
    doVibrate(120);

    resetWorld();
    var colorHex = settings.color;
    var count = settings.two ? 2 : 1;
    for (var i = 0; i < count; i++) {
        var d = createDie();
        var sx = (i === 0 ? 0 : 1.2);
        d.body.position.set(sx + (Math.random() - 0.5) * 0.6, 7 + Math.random() * 2, (Math.random() - 0.5) * 0.8);
        d.body.quaternion.set(Math.random(), Math.random(), Math.random(), Math.random());
        d.body.angularVelocity.set(
            (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30
        );
        d.body.velocity.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
        scene.add(d.mesh);
        if (d.pips) d.pips.forEach(function (p) { p.material.color.set(colorHex === '#ffffff' ? 0x222222 : 0x111111); });
        world.addBody(d.body);
        activeDice.push(d);
    }

    var settleTimer = 0;
    var settleFrames = 0;
    var settled = false;

    function step() {
        world.step(1 / 60);
        activeDice.forEach(function (d) {
            d.mesh.position.copy(d.body.position);
            d.mesh.quaternion.copy(d.body.quaternion);
        });
        var sleeping = activeDice.every(function (d) {
            return d.body.velocity.lengthSquared() < 0.04 &&
                   d.body.angularVelocity.lengthSquared() < 0.06;
        });
        if (sleeping) { settleFrames++; } else { settleFrames = 0; }
        if (settleFrames > 8 && !settled) {
            settled = true;
            finishRoll();
            return;
        }
        if (!settled) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    function finishRoll() {
        var values = activeDice.map(function (d) { return getDieValue(d); });
        totalRolls++;
        saveTotal();
        var entry = { t: Date.now(), type: dieType, values: values };
        if (values.length === 2) {
            entry.sum = values[0] + values[1];
            entry.double = values[0] === values[1];
        }
        history.unshift(entry);
        history = history.slice(0, 50);
        saveHistory();
        renderHistory();

        var stats = loadStats();
        values.forEach(function (v) { stats[v] = (stats[v] || 0) + 1; });
        saveStats(stats);
        renderStats();
        updateHUD();

        var msg = values.join(' + ');
        if (values.length === 2) msg += ' = ' + (entry.sum);
        document.getElementById('log').textContent = msg;
        if (entry.double) document.getElementById('log').textContent = '🎉 ¡DOBLES! ' + msg;
        doVibrate(150);
        rolling = false;
        document.getElementById('rollBtn').classList.remove('disabled');
    }
}

/* ---------- Shake (desde Android o web) ---------- */
window.onShake = function () {
    if (settings.shake && !rolling) {
        initAudio();
        roll();
    }
};

/* ---------- Loop de render ---------- */
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('touchstart', function (e) {
    if (e.target.closest && !e.target.closest('#rollBtn')) initAudio();
}, { passive: true });

/* ---------- Init ---------- */
loadHistory();
loadTotal();
document.body.classList.toggle('light', settings.theme === 'light');
initUI();
renderHistory();
renderStats();
updateHUD();
rebuildDice();
updateCamera();
animate();