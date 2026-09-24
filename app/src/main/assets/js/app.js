/* Dado Virtual - app principal
   Three.js + cannon.js : dado 3D con físicas reales */

/* ---------- Manejo global de errores ---------- */
window.onerror = function (msg, src, line) {
    var el = document.getElementById('errorBox');
    if (el) el.textContent = 'Error: ' + msg + ' (línea ' + line + ')';
    return false;
};

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
var rollHistory = [];
var totalRolls = 0;
var dieType = 'd6';
var rollInProgress = false;

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
        if (raw) rollHistory = JSON.parse(raw);
    } catch (e) {}
    rollHistory = rollHistory.slice(0, 50);
}
function saveHistory() {
    try { localStorage.setItem('dv_history', JSON.stringify(rollHistory.slice(0, 50))); } catch (e) {}
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
var scene, camera, renderer, world, tableBody, wallBodies = [];
var dieMaterial, tableMaterial;
var activeDice = [];

function init3D() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 4.2, 8.5);
    camera.lookAt(0, 0.5, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    try {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (e) {}
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    var dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 10, 6);
    scene.add(dirLight);
    scene.add(new THREE.DirectionalLight(0x88aaff, 0.35).translateX(-6));

    /* Mesa (suelo) */
    var tableMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.8, metalness: 0.1 });
    var table = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 7), tableMat);
    table.position.y = -0.25;
    table.receiveShadow = true;
    scene.add(table);

    /* Paredes alrededor para que el dado rebote (zona segura) */
    var wallMat = new THREE.MeshStandardMaterial({
        color: 0x1c2833, roughness: 0.9, transparent: true, opacity: 0.35
    });
    var wallH = 3.2, t = 3.5;
    var wallDefs = [
        { w: 7.2, h: wallH, d: 0.4, x: 0, y: wallH / 2 - 0.25, z: t },
        { w: 7.2, h: wallH, d: 0.4, x: 0, y: wallH / 2 - 0.25, z: -t },
        { w: 0.4, h: wallH, d: 7.2, x: t, y: wallH / 2 - 0.25, z: 0 },
        { w: 0.4, h: wallH, d: 7.2, x: -t, y: wallH / 2 - 0.25, z: 0 }
    ];
    wallDefs.forEach(function (w) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), wallMat);
        m.position.set(w.x, w.y, w.z);
        scene.add(m);
    });

    /* Mundo físico */
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    dieMaterial = new CANNON.Material('die');
    tableMaterial = new CANNON.Material('table');
    var contact = new CANNON.ContactMaterial(dieMaterial, tableMaterial, { friction: 0.25, restitution: 0.4 });
    world.addContactMaterial(contact);

    tableBody = new CANNON.Body({ mass: 0, material: tableMaterial });
    tableBody.addShape(new CANNON.Box(new CANNON.Vec3(3.5, 0.25, 3.5)));
    tableBody.position.y = -0.25;
    world.addBody(tableBody);

    wallDefs.forEach(function (w) {
        var b = new CANNON.Body({ mass: 0 });
        b.addShape(new CANNON.Box(new CANNON.Vec3(w.w / 2, w.h / 2, w.d / 2)));
        b.position.set(w.x, w.y, w.z);
        world.addBody(b);
        wallBodies.push(b);
    });

    /* Suelo de seguridad: si el dado escapa de la mesa, cae aquí y no al vacío */
    var catchBody = new CANNON.Body({ mass: 0 });
    catchBody.addShape(new CANNON.Box(new CANNON.Vec3(8, 0.3, 8)));
    catchBody.position.y = -3.2;
    world.addBody(catchBody);
    var catchMesh = new THREE.Mesh(
        new THREE.BoxGeometry(16, 0.6, 16),
        new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1 })
    );
    catchMesh.position.y = -3.2;
    scene.add(catchMesh);
}

function resetWorld() {
    for (var i = 0; i < activeDice.length; i++) {
        var d = activeDice[i];
        if (d.mesh) scene.remove(d.mesh);
        if (d.body) world.removeBody(d.body);
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

/* Datos estándar de poliedros (vértices + caras triangulares), independientes de THREE.Geometry */
var POLY_DATA = {
    d4: {
        vertices: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]],
        faces: [[2, 1, 0], [0, 3, 2], [1, 3, 0], [2, 3, 1]]
    },
    d8: {
        vertices: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
        faces: [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
                [1, 2, 5], [1, 5, 3], [1, 3, 4], [1, 4, 2]]
    },
    d20: {
        vertices: [
            [-1, 1.618, 0], [1, 1.618, 0], [-1, -1.618, 0], [1, -1.618, 0],
            [0, -1, 1.618], [0, 1, 1.618], [0, -1, -1.618], [0, 1, -1.618],
            [1.618, 0, -1], [1.618, 0, 1], [-1.618, 0, -1], [-1.618, 0, 1]
        ],
        faces: [
            [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
            [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
            [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
        ]
    }
};

function tetraFaces() {
    var data = POLY_DATA.d4;
    return polyFromTris(data.vertices, data.faces);
}
function octaFaces() {
    var data = POLY_DATA.d8;
    return polyFromTris(data.vertices, data.faces);
}
function icosaFaces() {
    var data = POLY_DATA.d20;
    return polyFromTris(data.vertices, data.faces);
}

/* Convierte un poliedro con caras triangulares a caras poligonales únicas */
function polyFromTris(verts, tris) {
    var used = new Array(tris.length).fill(false);
    var polys = [];
    for (var i = 0; i < tris.length; i++) {
        if (used[i]) continue;
        var set = new Set();
        var base = faceNormal(verts, tris[i]);
        for (var j = 0; j < tris.length; j++) {
            if (used[j]) continue;
            if (dotV(base, faceNormal(verts, tris[j])) > 0.95) {
                used[j] = true;
                set.add(tris[j][0]); set.add(tris[j][1]); set.add(tris[j][2]);
            }
        }
        polys.push({ idx: Array.from(set) });
    }
    return { vertices: verts, faces: polys.map(function (p) { return p.idx; }) };
}

function decahedron() {
    var verts = [];
    verts.push([0, 1.4, 0]);
    verts.push([0, -1.4, 0]);
    for (var k = 0; k < 5; k++) {
        var a = 2 * Math.PI * k / 5;
        verts.push([Math.cos(a), 0, Math.sin(a)]);
    }
    var faces = [];
    for (var k2 = 0; k2 < 5; k2++) {
        var e1 = 2 + k2, e2 = 2 + ((k2 + 1) % 5);
        faces.push([0, e1, e2]);
        faces.push([1, e2, e1]);
    }
    return { vertices: verts, faces: faces };
}

function dodecahedron() {
    var phi = (1 + Math.sqrt(5)) / 2;
    var r = 1 / phi, t = phi;
    var verts = [
        [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
        [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
        [0, -r, -t], [0, -r, t], [0, r, -t], [0, r, t],
        [-r, -t, 0], [-r, t, 0], [r, -t, 0], [r, t, 0],
        [-t, 0, -r], [t, 0, -r], [-t, 0, r], [t, 0, r]
    ];
    var tris = [
        [3, 11, 7], [3, 7, 15], [3, 15, 13],
        [7, 19, 17], [7, 17, 6], [7, 6, 15],
        [17, 4, 8], [17, 8, 10], [17, 10, 6],
        [8, 0, 16], [8, 16, 2], [8, 2, 10],
        [0, 12, 1], [0, 1, 18], [0, 18, 16],
        [6, 10, 2], [6, 2, 13], [6, 13, 15],
        [2, 16, 18], [2, 18, 3], [2, 3, 13],
        [18, 1, 9], [18, 9, 11], [18, 11, 3],
        [4, 14, 12], [4, 12, 0], [4, 0, 8],
        [11, 9, 5], [11, 5, 19], [11, 19, 7],
        [19, 5, 14], [19, 14, 4], [19, 4, 17],
        [1, 12, 14], [1, 14, 5], [1, 5, 9]
    ];
    return polyFromTris(verts, tris);
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
    return new THREE.CanvasTexture(c);
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
    var verts = facesData.vertices;
    var faces = orientFacesOutward(verts, facesData.faces);
    var normals = faces.map(function (f) { return faceNormal(verts, f); });
    var labels = assignOppositeLabels(normals, faces.length);

    var scale = 0.9 / (lenV(verts[0]) || 1);
    var scaled = verts.map(function (v) { return [v[0] * scale, v[1] * scale, v[2] * scale]; });

    var geo = buildDieGeometry(scaled, faces, labels, colorHex);
    var mats = labels.map(function (l) {
        return new THREE.MeshStandardMaterial({
            map: numberTexture(l, colorHex), roughness: 0.4, metalness: 0.1
        });
    });
    var mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;

    var cnvVerts = scaled.map(function (v) { return new CANNON.Vec3(v[0], v[1], v[2]); });
    var hull = new CANNON.ConvexPolyhedron(cnvVerts, faces);
    var body = new CANNON.Body({ mass: 1, material: dieMaterial });
    body.addShape(hull);

    return { mesh: mesh, body: body, normals: normals, labels: labels, scale: scale, isD6: false };
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
        PIPS[d.val].forEach(function (p) {
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
    var data = dieType === 'd10' ? decahedron()
        : dieType === 'd12' ? dodecahedron()
        : dieType === 'd4' ? tetraFaces()
        : dieType === 'd8' ? octaFaces()
        : icosaFaces();
    var def = DICE_TYPES.filter(function (d) { return d.id === dieType; })[0];
    return buildRpgDie(data, def.label, colorHex);
}

function getDieValue(die) {
    var q = die.body.quaternion;
    var best = -2, value = 0;
    if (die.isD6) {
        die.dirs.forEach(function (d) {
            var nx = (1 - 2 * (q.y * q.y + q.z * q.z)) * d.dir[0] + 2 * (q.x * q.y - q.w * q.z) * d.dir[1] + 2 * (q.x * q.z + q.w * q.y) * d.dir[2];
            var ny = 2 * (q.x * q.y + q.w * q.z) * d.dir[0] + (1 - 2 * (q.x * q.x + q.z * q.z)) * d.dir[1] + 2 * (q.y * q.z - q.w * q.x) * d.dir[2];
            var nz = 2 * (q.x * q.z - q.w * q.y) * d.dir[0] + 2 * (q.y * q.z + q.w * q.x) * d.dir[1] + (1 - 2 * (q.x * q.x + q.y * q.y)) * d.dir[2];
            var dot = ny;
            if (dot > best) { best = dot; value = d.val; }
        });
    } else {
        for (var i = 0; i < die.normals.length; i++) {
            var n = die.normals[i];
            var nx2 = (1 - 2 * (q.y * q.y + q.z * q.z)) * n[0] + 2 * (q.x * q.y - q.w * q.z) * n[1] + 2 * (q.x * q.z + q.w * q.y) * n[2];
            var ny2 = 2 * (q.x * q.y + q.w * q.z) * n[0] + (1 - 2 * (q.x * q.x + q.z * q.z)) * n[1] + 2 * (q.y * q.z - q.w * q.x) * n[2];
            var nz2 = 2 * (q.x * q.z - q.w * q.y) * n[0] + 2 * (q.y * q.z + q.w * q.x) * n[1] + (1 - 2 * (q.x * q.x + q.y * q.y)) * n[2];
            var dot2 = ny2;
            if (dot2 > best) { best = dot2; value = die.labels[i]; }
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
            document.querySelectorAll('.dice-chip').forEach(function (c) { c.classList.remove('active'); });
            b.classList.add('active');
            rebuildDice();
            renderStats();
        };
        diceRow.appendChild(b);
    });

    var colorRow = document.getElementById('colorRow');
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
    };

    document.getElementById('btnSettings').onclick = function () {
        document.getElementById('panel').classList.toggle('show');
    };
    document.getElementById('btnClose').onclick = function () {
        document.getElementById('panel').classList.remove('show');
    };
    /* cerrar panel al hacer click fuera */
    document.addEventListener('click', function (e) {
        var panel = document.getElementById('panel');
        if (!panel.classList.contains('show')) return;
        if (panel.contains(e.target)) return;
        if (e.target.id === 'btnSettings') return;
        panel.classList.remove('show');
    });
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

function rebuildDice() {
    if (!world) return;
    resetWorld();
    var count = settings.two ? 2 : 1;
    for (var i = 0; i < count; i++) {
        var d = createDie();
        d.mesh.position.set(i * 1.1, 0.6, 0);
        d.body.position.set(i * 1.1, 0.6, 0);
        d.body.quaternion.set(Math.random(), Math.random(), Math.random(), Math.random());
        scene.add(d.mesh);
        world.addBody(d.body);
        activeDice.push(d);
    }
    document.getElementById('rollBtn').classList.remove('disabled');
    document.getElementById('result').textContent = 'Pulsa el botón para tirar';
}

function renderHistory() {
    var list = document.getElementById('historyList');
    list.innerHTML = '';
    if (rollHistory.length === 0) { list.innerHTML = '<div style="opacity:.6;font-size:13px">Sin resultados aún</div>'; return; }
    rollHistory.forEach(function (h) {
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
    var faces = DICE_TYPES.filter(function (d) { return d.id === dieType; })[0].faces;
    for (var v = 1; v <= faces; v++) {
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
}

/* ---------- Lógica de tirada ---------- */
var rollStartTime = 0;
var MAX_ROLL_MS = 8000;
var SAFE_LIMIT = 3.2;

function roll() {
    if (!world) return;
    /* permite re-tirar aunque haya una tirada en curso */
    if (rollInProgress) {
        resetWorld();
    }
    rollInProgress = true;
    rollStartTime = Date.now();
    settleFrames = 0;
    document.getElementById('rollBtn').classList.add('disabled');
    document.getElementById('result').textContent = '🎲';
    document.getElementById('log').textContent = '';
    playSound();
    doVibrate(120);

    resetWorld();
    var count = settings.two ? 2 : 1;
    for (var i = 0; i < count; i++) {
        var d = createDie();
        var sx = (i === 0 ? 0 : 1.1) + (Math.random() - 0.5) * 0.4;
        d.body.position.set(sx, 2.2 + Math.random(), (Math.random() - 0.5) * 0.8);
        d.body.quaternion.set(Math.random(), Math.random(), Math.random(), Math.random());
        d.body.angularVelocity.set(
            (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40
        );
        d.body.velocity.set((Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 3);
        scene.add(d.mesh);
        world.addBody(d.body);
        activeDice.push(d);
    }
}

var settleFrames = 0;

function keepInBounds(d) {
    var p = d.body.position;
    var out = false;
    if (p.x > SAFE_LIMIT || p.x < -SAFE_LIMIT ||
        p.z > SAFE_LIMIT || p.z < -SAFE_LIMIT ||
        p.y < -2.5 || p.y > 4.5) {
        out = true;
    }
    if (out) {
        /* reposicionar el dado dentro de la zona segura */
        d.body.position.set(0, 1.2, 0);
        d.body.velocity.set(0, 0, 0);
        d.body.angularVelocity.set(0, 0, 0);
        d.body.quaternion.set(Math.random(), Math.random(), Math.random(), Math.random());
    }
}

function physicsLoop() {
    if (!world) return;
    world.step(1 / 60);
    activeDice.forEach(function (d) {
        keepInBounds(d);
        d.mesh.position.copy(d.body.position);
        d.mesh.quaternion.copy(d.body.quaternion);
    });
    if (rollInProgress) {
        var sleeping = activeDice.every(function (d) {
            return d.body.velocity.lengthSquared() < 0.05 &&
                   d.body.angularVelocity.lengthSquared() < 0.08;
        });
        settleFrames = sleeping ? settleFrames + 1 : 0;
        var timedOut = (Date.now() - rollStartTime) > MAX_ROLL_MS;
        if (settleFrames > 10 || timedOut) {
            rollInProgress = false;
            finishRoll();
        }
    }
}

function finishRoll() {
    if (!activeDice.length) {
        document.getElementById('rollBtn').classList.remove('disabled');
        return;
    }
    var values = activeDice.map(function (d) { return getDieValue(d); });
    totalRolls++;
    saveTotal();
    var entry = { t: Date.now(), type: dieType, values: values };
    if (values.length === 2) {
        entry.sum = values[0] + values[1];
        entry.double = values[0] === values[1];
    }
    rollHistory.unshift(entry);
    rollHistory = rollHistory.slice(0, 50);
    saveHistory();
    renderHistory();

    var stats = loadStats();
    values.forEach(function (v) { stats[v] = (stats[v] || 0) + 1; });
    saveStats(stats);
    renderStats();
    updateHUD();

    var msg = values.join(' + ');
    if (values.length === 2) msg += ' = ' + entry.sum;
    document.getElementById('log').textContent = entry.double ? '🎉 ¡DOBLES! ' + msg : msg;
    doVibrate(150);
    document.getElementById('rollBtn').classList.remove('disabled');
}

/* ---------- Shake ---------- */
window.onShake = function () {
    if (settings.shake && world) {
        initAudio();
        roll();
    }
};

/* ---------- Loop de render ---------- */
function animate() {
    requestAnimationFrame(animate);
    if (renderer && scene) {
        physicsLoop();
        renderer.render(scene, camera);
    }
}

window.addEventListener('resize', function () {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- Init ---------- */
loadHistory();
loadTotal();
document.body.classList.toggle('light', settings.theme === 'light');
initUI();
renderHistory();
renderStats();
updateHUD();

try {
    init3D();
    rebuildDice();
    animate();
} catch (e) {
    var el = document.getElementById('errorBox');
    if (el) el.textContent = 'No se pudo iniciar el 3D: ' + e.message;
}