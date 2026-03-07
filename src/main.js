import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GRAVITY = 30;
const STEPS_PER_FRAME = 5;
const JUMP_FORCE = 15;
const MOVE_SPEED = 8;
const SPRINT_SPEED = 18;
const BULLET_RADIUS = 0.4;
const BULLET_SPEED = 30;
const FIRE_RATE_MS = 150;
const AMMO_REGEN_RATE = 25;
const GUN_POSITION_X = 0.1;
const GUN_POSITION_Y = -0.08;
const GUN_POSITION_Z = -0.21;
const GUN_ROTATION_X = 3;
const GUN_ROTATION_Y = 100;

const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xfff4c9, 2.5);
directionalLight.position.set(-5, 25, -1);
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.01;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.left = -30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = -30;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.radius = 4;
directionalLight.shadow.bias = -0.00006;
scene.add(directionalLight);

const worldOctree = new Octree();
let playerOnFloor = false;

const loadingManager = new THREE.LoadingManager();
const loadingProgress = document.getElementById('loading-progress');
const loadingScreen = document.getElementById('loading-screen');

loadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
    loadingProgress.innerText = Math.floor((itemsLoaded / itemsTotal) * 100) + '%';
};

loadingManager.onLoad = function () {
    loadingScreen.style.display = 'none';
    renderer.setAnimationLoop(animate);
    sounds.bgm.play();
};

const gltfLoader = new GLTFLoader(loadingManager);
const rgbeLoader = new RGBELoader(loadingManager);

const listener = new THREE.AudioListener();
camera.add(listener);

const audioLoader = new THREE.AudioLoader(loadingManager);
const sounds = {
    bgm: new THREE.Audio(listener),
    shot: new THREE.Audio(listener),
    impact: new THREE.Audio(listener),
    hurt1: new THREE.Audio(listener),
    hurt2: new THREE.Audio(listener),
    dash: new THREE.Audio(listener),
    damaging: new THREE.Audio(listener)
};

const playSound = (audio) => {
    if (audio.isPlaying) audio.stop();
    audio.play();
};

audioLoader.load('assets/bgm.ogg', b => { sounds.bgm.setBuffer(b); sounds.bgm.setLoop(true); sounds.bgm.setVolume(0.3); });
audioLoader.load('assets/shot.ogg', b => sounds.shot.setBuffer(b));
audioLoader.load('assets/bullet-hit.ogg', b => sounds.impact.setBuffer(b));
audioLoader.load('assets/hurt1.ogg', b => sounds.hurt1.setBuffer(b));
audioLoader.load('assets/hurt2.ogg', b => sounds.hurt2.setBuffer(b));
audioLoader.load('assets/mini-boss-shift.ogg', b => sounds.dash.setBuffer(b));
audioLoader.load('assets/damaging.ogg', b => { sounds.damaging.setBuffer(b); sounds.damaging.setLoop(true); sounds.damaging.setVolume(0.8); });

let auraBuffer1, auraBuffer2, auraBuffer3;
audioLoader.load('assets/basic-aura.ogg', b => auraBuffer1 = b);
audioLoader.load('assets/miniboss-aura.ogg', b => auraBuffer2 = b);
audioLoader.load('assets/boss-aura.ogg', b => auraBuffer3 = b);

let dieBuffer1, dieBuffer2, dieBuffer3;
audioLoader.load('assets/basic-die.ogg', b => dieBuffer1 = b);
audioLoader.load('assets/miniboss-die.ogg', b => dieBuffer2 = b);
audioLoader.load('assets/boss-die.ogg', b => dieBuffer3 = b);

rgbeLoader.load('assets/env.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    scene.background = texture;
});

const SharpenShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'resolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
    },
    vertexShader: ` varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); } `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        varying vec2 vUv;
        void main() {
            vec2 step = 1.0 / resolution;
            vec3 texA = texture2D(tDiffuse, vUv).rgb;
            vec3 texB = texture2D(tDiffuse, vUv + vec2(-step.x, -step.y)).rgb;
            vec3 texC = texture2D(tDiffuse, vUv + vec2(step.x, -step.y)).rgb;
            vec3 texD = texture2D(tDiffuse, vUv + vec2(-step.x, step.y)).rgb;
            vec3 texE = texture2D(tDiffuse, vUv + vec2(step.x, step.y)).rgb;
            vec3 sharpen = texA *6.0 - texB - texC - texD - texE;
            gl_FragColor = vec4(sharpen, 1.0);
        }
    `
};

const DamageShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'damageIntensity': { value: 0.0 }
    },
    vertexShader: ` varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); } `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float damageIntensity;
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            if (damageIntensity > 0.0) {
                vec4 blurColor = vec4(0.0);
                float dist = 0.005 * damageIntensity;
                blurColor += texture2D(tDiffuse, vUv + vec2(-dist, -dist));
                blurColor += texture2D(tDiffuse, vUv + vec2(dist, -dist));
                blurColor += texture2D(tDiffuse, vUv + vec2(-dist, dist));
                blurColor += texture2D(tDiffuse, vUv + vec2(dist, dist));
                blurColor += color;
                color = blurColor / 5.0;

                float distToCenter = distance(vUv, vec2(0.5));
                float vignette = smoothstep(0.4, 1.0, distToCenter);
                color.r += vignette * damageIntensity;
                color.gb -= vignette * damageIntensity;
            }
            gl_FragColor = color;
        }
    `
};

const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.1, 0.8);
const sharpenPass = new ShaderPass(SharpenShader);
const damagePass = new ShaderPass(DamageShader);

const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(sharpenPass);
composer.addPass(damagePass);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    sharpenPass.uniforms['resolution'].value.set(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

// --- REUSABLE TEMP OBJECTS (avoid per-frame allocations) ---
const _tempVec2 = new THREE.Vector2();
const _tempVec3 = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();
const _tempVec3C = new THREE.Vector3();
const _tempVec3D = new THREE.Vector3();
const _tempSphere = new THREE.Sphere();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);

// --- ANIMATION MIXERS & STATE ---
const mixers = [];
let gunMixer;
let currentDamageIntensity = 0.0;
let crosshairSpread = 0;
const MAX_SPREAD = 30;
const crosshairElement = document.getElementById('crosshair');

// --- POOLS SETUP ---
const sphereGeometry = new THREE.SphereGeometry(BULLET_RADIUS, 16, 16);
const bossSphereGeometry = new THREE.SphereGeometry(BULLET_RADIUS * 1.3, 16, 16);
const bulletMaterial = new THREE.MeshStandardMaterial({ color: 0x55ccff, emissive: 0x55ccff, emissiveIntensity: 3 });
const bossBulletMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 3 });

const bulletPool = [];
const bossBulletPool = [];

const impactPool = [];
const sparkCount = 10;
const sparkMat = new THREE.PointsMaterial({ color: 0xffdd44, size: 0.04, emissive: 0xffaa00, emissiveIntensity: 1000 });

function initPools() {
    for (let i = 0; i < 30; i++) {
        const mesh = new THREE.Mesh(sphereGeometry, bulletMaterial);
        mesh.visible = false;
        scene.add(mesh);
        bulletPool.push({ mesh, active: false, velocity: new THREE.Vector3(), timeAlive: 0, stopped: false, stopTime: 0 });
    }
    for (let i = 0; i < 24; i++) {
        const mesh = new THREE.Mesh(bossSphereGeometry, bossBulletMaterial);
        mesh.visible = false;
        scene.add(mesh);
        bossBulletPool.push({ mesh, active: false, velocity: new THREE.Vector3(), timeAlive: 0 });
    }
    for (let i = 0; i < 30; i++) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(sparkCount * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const pts = new THREE.Points(geo, sparkMat.clone());
        pts.visible = false;
        scene.add(pts);

        const vels = [];
        for (let j = 0; j < sparkCount; j++) {
            vels.push(new THREE.Vector3((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15));
        }
        impactPool.push({ mesh: pts, active: false, timeAlive: 0, velocities: vels });
    }
}
initPools();

function getBullet() { return bulletPool.find(b => !b.active); }
function getBossBullet() { return bossBulletPool.find(b => !b.active); }

function spawnImpact(position) {
    const impact = impactPool.find(p => !p.active);
    if (!impact) return;

    impact.active = true;
    impact.timeAlive = 0;
    impact.mesh.visible = true;
    impact.mesh.position.copy(position);
    impact.mesh.material.opacity = 1;

    const posAttr = impact.mesh.geometry.attributes.position;
    for (let i = 0; i < posAttr.array.length; i++) posAttr.array[i] = 0;
    posAttr.needsUpdate = true;
}

function updateImpacts(deltaTime) {
    for (const impact of impactPool) {
        if (!impact.active) continue;
        impact.timeAlive += deltaTime;
        if (impact.timeAlive > 0.3) {
            impact.active = false;
            impact.mesh.visible = false;
            continue;
        }

        impact.mesh.material.opacity = 1.0 - (impact.timeAlive / 0.3);

        const posAttr = impact.mesh.geometry.attributes.position;
        for (let i = 0; i < sparkCount; i++) {
            posAttr.array[i * 3] += impact.velocities[i].x * deltaTime;
            posAttr.array[i * 3 + 1] += impact.velocities[i].y * deltaTime;
            posAttr.array[i * 3 + 2] += impact.velocities[i].z * deltaTime;
        }
        posAttr.needsUpdate = true;
    }
}

const enemyModels = {};

function setupEnemyModel(model, type, emissiveColor) {
    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.material.emissive = new THREE.Color(emissiveColor);
            if (type == 3) child.material.emissiveIntensity = 0.6;
            else child.material.emissiveIntensity = 2;
        }
    });
    enemyModels[type] = model;
}

const enemyPool = [];

class Enemy {
    constructor(mesh, type, hp, speed, mixer) {
        this.mesh = mesh;
        this.type = type;
        this.hp = hp;
        this.maxHp = hp;
        this.speed = speed;
        this.timeAlive = 0;
        this.lastAttackTime = 0;
        this.active = false;
        this.mixer = mixer;
        this.action = null;
        this.state = 'alive';
        this.deathTime = 0;
        this.lastDamageToPlayerTime = 0;

        if (this.mixer && mesh.animations && mesh.animations.length > 0) {
            this.action = this.mixer.clipAction(mesh.animations[0]);
        }

        // Cache mesh children for fast iteration (avoid traverse() in hot loops)
        this.meshChildren = [];
        mesh.traverse((child) => {
            if (child.isMesh && child.material) this.meshChildren.push(child);
        });

        this.auraSound = new THREE.PositionalAudio(listener);
        this.auraSound.setRefDistance(2);
        this.auraSound.setMaxDistance(20);
        this.auraSound.setLoop(true);
        mesh.add(this.auraSound);

        this.deathSound = new THREE.PositionalAudio(listener);
        this.deathSound.setRefDistance(2);
        this.deathSound.setMaxDistance(20);
        this.deathSound.setLoop(false);
        mesh.add(this.deathSound);

        this.isDashing = false;
        this.dashTarget = new THREE.Vector3();
        this.dashTimer = 0;

        // Swarm offset angle for type 1 enemies (randomized on spawn)
        this.swarmAngle = 0;
    }
}

function initEnemyPools() {
    const config = [
        { type: 1, count: 20, file: 'assets/basic_enemy.glb', color: 0x002020, hp: 30, speed: 3, scale: 0.5 },
        { type: 2, count: 2, file: 'assets/miniboss.glb', color: 0xaa00aa, hp: 200, speed: 4, scale: 0.9 },
        { type: 3, count: 1, file: 'assets/boss.glb', color: 0xff5500, hp: 3000, speed: 2, scale: 1.5 }
    ];

    config.forEach(c => {
        gltfLoader.load(c.file, (gltf) => {
            setupEnemyModel(gltf.scene, c.type, c.color);
            gltf.scene.animations = gltf.animations;
            for (let i = 0; i < c.count; i++) {
                const mesh = gltf.scene.clone();
                mesh.traverse((m) => {
                    if (m.isMesh && m.material) {
                        m.material = m.material.clone();
                    }
                });
                mesh.animations = gltf.animations;
                mesh.scale.set(c.scale, c.scale, c.scale);
                mesh.visible = false;
                scene.add(mesh);
                const mixer = new THREE.AnimationMixer(mesh);
                mixers.push(mixer);
                enemyPool.push(new Enemy(mesh, c.type, c.hp, c.speed, mixer));
            }
        });
    });
}
initEnemyPools();

function getEnemyFromPool(type) {
    return enemyPool.find(e => e.type === type && !e.active && e.state !== 'dying');
}

let gun;
let muzzleFlash;
let lastFireTime = 0;

gltfLoader.load('assets/gun.glb', (gltf) => {
    gun = gltf.scene;
    gun.scale.set(0.2, 0.2, 0.2);
    gun.position.set(GUN_POSITION_X, GUN_POSITION_Y, GUN_POSITION_Z);
    gun.rotation.y = THREE.MathUtils.degToRad(GUN_ROTATION_Y);
    gun.rotation.x = THREE.MathUtils.degToRad(GUN_ROTATION_X);

    muzzleFlash = new THREE.PointLight(0xffffff, 0, 10);
    muzzleFlash.position.set(-0.6, -0.6, -1);
    gun.add(muzzleFlash);

    gun.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    if (gltf.animations && gltf.animations.length > 0) {
        gunMixer = new THREE.AnimationMixer(gun);
        mixers.push(gunMixer);
        const action = gunMixer.clipAction(gltf.animations[0]);
        action.play();
    }

    camera.add(gun);
    scene.add(camera);
});

gltfLoader.load('assets/warehouse.glb', (gltf) => {
    const level = gltf.scene;
    scene.add(level);
    worldOctree.fromGraphNode(level);

    level.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.name.includes("Emissive")) {
                const mat = child.material.clone();
                mat.emissive = new THREE.Color(0xffaa55);
                mat.emissiveIntensity = 2;
                child.material = mat;
            }
        }
    });
});

const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let ammo = 100;
let hp = 100;
let isMouseDown = false;
let totalElapsed = 0;
let bossSpawned = false;

const uiAmmo = document.getElementById('ammo-bar-fill');
const uiHp = document.getElementById('hp-bar-fill');
const uiBoss = document.getElementById('boss-ui');
const uiBossHpBar = document.getElementById('boss-hp-bar-fill');

const clearedScreen = document.getElementById('cleared-screen');
const clearedTime = document.getElementById('time-value');
document.getElementById('btn-restart').addEventListener('click', () => { location.reload(); });
document.getElementById('btn-restart-go').addEventListener('click', () => { location.reload(); });

let isGameOver = false;

function setGameOver(win) {
    isGameOver = true;
    document.exitPointerLock();

    [sounds.shot, sounds.impact, sounds.hurt1, sounds.hurt2, sounds.dash, sounds.damaging].forEach(s => {
        if (s && s.isPlaying) s.stop();
    });

    enemyPool.forEach(e => {
        if (e.auraSound && e.auraSound.isPlaying) e.auraSound.stop();
        if (e.deathSound && e.deathSound.isPlaying) e.deathSound.stop();
    });

    if (win) {
        clearedTime.innerText = totalElapsed.toFixed(2);
        clearedScreen.style.display = 'flex';
    } else {
        document.getElementById('gameover-screen').style.display = 'flex';
    }
}

let lastParamsSpawnTime = 0;
let lastParamsMiniBossDeadTime = 0;

function spawnEnemy(type, position) {
    const enemy = getEnemyFromPool(type);
    if (!enemy) return;

    enemy.active = true;
    enemy.state = 'alive';
    enemy.deathTime = 0;
    enemy.mesh.visible = true;
    enemy.mesh.position.copy(position);

    // Stop any lingering death sound from previous life
    if (enemy.deathSound && enemy.deathSound.isPlaying) enemy.deathSound.stop();

    // Reset hp, speed, scale, and type-specific state
    if (type === 1) {
        enemy.hp = 50; enemy.speed = 3;
        enemy.mesh.scale.set(0.5, 0.5, 0.5);
        enemy.mesh.rotation.y = Math.random() * Math.PI * 2;
        enemy.swarmAngle = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 6 + Math.random() * Math.PI / 3);
    } else if (type === 2) {
        enemy.hp = 300; enemy.speed = 4;
        enemy.mesh.scale.set(1.0, 1.0, 1.0);
        enemy.isDashing = false;
        enemy.dashTimer = 0;
    } else if (type === 3) {
        enemy.hp = 3000; enemy.speed = 2;
        enemy.mesh.scale.set(2.0, 2.0, 2.0);
    }

    // Reset emissive intensity (death animation cranks it up)
    for (const child of enemy.meshChildren) {
        child.material.emissiveIntensity = 2;
    }

    enemy.maxHp = enemy.hp;
    enemy.timeAlive = 0;
    enemy.lastAttackTime = 0;
    enemy.lastDamageToPlayerTime = totalElapsed; // prevent instant damage on spawn

    if (enemy.action) {
        enemy.action.reset();
        enemy.action.play();
    }

    if (type === 1 && auraBuffer1) { enemy.auraSound.setBuffer(auraBuffer1); enemy.auraSound.play(); }
    if (type === 2 && auraBuffer2) { enemy.auraSound.setBuffer(auraBuffer2); enemy.auraSound.play(); }
    if (type === 3 && auraBuffer3) { enemy.auraSound.setBuffer(auraBuffer3); enemy.auraSound.play(); }
}

const keyStates = {};
document.addEventListener('keydown', (event) => { keyStates[event.code] = true; });
document.addEventListener('keyup', (event) => { keyStates[event.code] = false; });
document.addEventListener('mousedown', (e) => {
    if (isGameOver) return;
    if (document.pointerLockElement !== document.body) {
        document.body.requestPointerLock();
    } else {
        if (e.button === 0) isMouseDown = true;
    }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) isMouseDown = false; });
let mouseSwayX = 0;
let mouseSwayY = 0;

document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        camera.rotation.y -= event.movementX / 500;
        camera.rotation.x -= event.movementY / 500;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));

        mouseSwayX -= event.movementX * 0.0002;
        mouseSwayY += event.movementY * 0.0002;
    }
});

function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

function controls(deltaTime) {
    const isSprinting = keyStates['ShiftLeft'] || keyStates['ShiftRight'];
    const speedMult = isSprinting ? SPRINT_SPEED : MOVE_SPEED;
    const speedDelta = deltaTime * (playerOnFloor ? speedMult * 3 : speedMult);

    if (keyStates['KeyW']) playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));
    if (keyStates['KeyS']) playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
    if (keyStates['KeyA']) playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
    if (keyStates['KeyD']) playerVelocity.add(getSideVector().multiplyScalar(speedDelta));

    if (playerOnFloor && keyStates['Space']) playerVelocity.y = JUMP_FORCE;
}

function playerCollisions() {
    const result = worldOctree.capsuleIntersect(playerCollider);
    playerOnFloor = false;

    if (result) {
        playerOnFloor = result.normal.y >= 0.15;
        if (!playerOnFloor) playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
        if (result.depth >= 1e-10) playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }

    for (const enemy of enemyPool) {
        if (!enemy.active || enemy.state === 'dying') continue;

        const radius = enemy.type === 3 ? 2 : (enemy.type === 2 ? 1.0 : 0.5);
        _tempVec2.set(camera.position.x - enemy.mesh.position.x, camera.position.z - enemy.mesh.position.z);
        const distSq = _tempVec2.lengthSq();
        const minDistance = radius + playerCollider.radius;

        if (distSq < minDistance * minDistance && camera.position.y > enemy.mesh.position.y && camera.position.y < enemy.mesh.position.y + radius * 2 + 1) {
            const dist = Math.sqrt(distSq);
            const overlap = minDistance - dist;
            if (dist > 0.001) {
                const dirX = (camera.position.x - enemy.mesh.position.x) / dist;
                const dirZ = (camera.position.z - enemy.mesh.position.z) / dist;
                _tempVec3.set(dirX * overlap, 0, dirZ * overlap);
                playerCollider.translate(_tempVec3);
            }
        }
    }
}

function resolveEnemyEnemyCollisions() {
    for (let i = 0; i < enemyPool.length; i++) {
        const e1 = enemyPool[i];
        if (!e1.active || e1.state === 'dying') continue;

        const r1 = e1.type === 3 ? 2.0 : (e1.type === 2 ? 1.0 : 0.5);

        for (let j = i + 1; j < enemyPool.length; j++) {
            const e2 = enemyPool[j];
            if (!e2.active || e2.state === 'dying') continue;

            const r2 = e2.type === 3 ? 2.0 : (e2.type === 2 ? 1.0 : 0.5);
            const minDist = r1 + r2;

            const dx = e1.mesh.position.x - e2.mesh.position.x;
            const dz = e1.mesh.position.z - e2.mesh.position.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < minDist * minDist) {
                const dist = Math.sqrt(distSq);
                const overlap = (minDist - dist) * 0.5;
                if (dist > 0.001) {
                    const nx = dx / dist;
                    const nz = dz / dist;
                    e1.mesh.position.x += nx * overlap;
                    e1.mesh.position.z += nz * overlap;
                    e2.mesh.position.x -= nx * overlap;
                    e2.mesh.position.z -= nz * overlap;
                }
            }
        }
    }
}

function updatePlayer(deltaTime) {
    let damping = Math.exp(-4 * deltaTime) - 1;

    if (!playerOnFloor) {
        playerVelocity.y -= GRAVITY * deltaTime;
        damping *= 0.1;
    }

    playerVelocity.addScaledVector(playerVelocity, damping);
    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(deltaPosition);

    playerCollisions();
    camera.position.copy(playerCollider.end);
}

function tryShoot() {
    const now = performance.now();
    if (now - lastFireTime < FIRE_RATE_MS || ammo < 5) return;

    const bullet = getBullet();
    if (!bullet) return;

    lastFireTime = now;
    ammo = Math.max(0, ammo - 5);
    uiAmmo.style.width = Math.floor(ammo) + '%';
    playSound(sounds.shot);

    if (muzzleFlash) {
        muzzleFlash.intensity = 10;
        setTimeout(() => { if (muzzleFlash) muzzleFlash.intensity = 0; }, 50);
    }

    if (gun) {
        gun.position.z += 0.15;
        gun.rotation.x += 0.2;
    }

    crosshairSpread = Math.min(crosshairSpread + 6, MAX_SPREAD);

    const spreadAngle = (crosshairSpread / 1000) * (Math.random() - 0.5) * 2.0;
    const spreadAngle2 = (crosshairSpread / 1000) * (Math.random() - 0.5) * 2.0;

    bullet.active = true;
    bullet.timeAlive = 0;
    bullet.stopped = false;
    bullet.stopTime = 0;
    bullet.mesh.visible = true;
    bullet.mesh.position.copy(camera.position);

    _tempVec3.set(0.2, -0.2, -1);
    _tempVec3.applyQuaternion(camera.quaternion);
    bullet.mesh.position.add(_tempVec3);

    bullet.velocity.set(0, 0, -1);
    bullet.velocity.applyAxisAngle(_axisX, spreadAngle);
    bullet.velocity.applyAxisAngle(_axisY, spreadAngle2);
    bullet.velocity.applyQuaternion(camera.quaternion);
    bullet.velocity.multiplyScalar(BULLET_SPEED);
}

function updateCrosshairUI(deltaTime) {
    if (!isMouseDown && crosshairSpread > 0) {
        crosshairSpread -= deltaTime * 50;
        if (crosshairSpread < 0) crosshairSpread = 0;
    }
    crosshairElement.style.width = 15 + crosshairSpread + "px";
    crosshairElement.style.height = 15 + crosshairSpread + "px";
}

function updateGunAndBullets(deltaTime) {
    if (ammo < 100) {
        ammo = Math.min(100, ammo + AMMO_REGEN_RATE * deltaTime);
        uiAmmo.style.width = Math.floor(ammo) + '%';
    }

    if (gun) {
        mouseSwayX = THREE.MathUtils.lerp(mouseSwayX, 0, deltaTime * 5);
        mouseSwayY = THREE.MathUtils.lerp(mouseSwayY, 0, deltaTime * 5);
        mouseSwayX = Math.max(-0.05, Math.min(0.05, mouseSwayX));
        mouseSwayY = Math.max(-0.05, Math.min(0.05, mouseSwayY));

        const bobSpeed = playerOnFloor && playerVelocity.length() > 2 ? totalElapsed * 15 : 0;
        const bobSwayX = Math.sin(bobSpeed) * 0.003;
        const bobSwayY = Math.abs(Math.cos(bobSpeed)) * 0.003;

        const targetX = GUN_POSITION_X + mouseSwayX + bobSwayX;
        const targetY = GUN_POSITION_Y + mouseSwayY - bobSwayY;

        _tempVec3B.set(targetX, targetY, GUN_POSITION_Z);
        gun.position.lerp(_tempVec3B, 0.1);
        gun.rotation.x = THREE.MathUtils.lerp(gun.rotation.x, THREE.MathUtils.degToRad(GUN_ROTATION_X), 0.1);
    }

    if (gunMixer) {
        if (!isMouseDown) {
            gunMixer.timeScale = THREE.MathUtils.lerp(gunMixer.timeScale, 1.0, deltaTime * 5);
        } else {
            gunMixer.timeScale = THREE.MathUtils.lerp(gunMixer.timeScale, 20.0, deltaTime * 10);
        }
    }

    updateCrosshairUI(deltaTime);

    for (const b of bulletPool) {
        if (!b.active) continue;

        if (b.stopped) {
            b.stopTime += deltaTime;
            if (b.stopTime >= 0.05) {
                b.active = false;
                b.mesh.visible = false;
            }
            continue;
        }

        b.timeAlive += deltaTime;

        if (b.timeAlive > 3.0) {
            b.active = false;
            b.mesh.visible = false;
            continue;
        }

        b.mesh.position.addScaledVector(b.velocity, deltaTime);

        _tempSphere.set(b.mesh.position, BULLET_RADIUS);
        const result = worldOctree.sphereIntersect(_tempSphere);

        if (result) {
            spawnImpact(b.mesh.position);
            b.stopped = true;
            b.stopTime = 0;
            continue;
        }

        for (const enemy of enemyPool) {
            if (!enemy.active || enemy.state === 'dying') continue;
            const dist = b.mesh.position.distanceTo(enemy.mesh.position);
            const radius = enemy.type === 3 ? 3 : (enemy.type === 2 ? 1.5 : 0.8);

            if (dist < radius) {
                enemy.hp -= 10;
                spawnImpact(b.mesh.position);

                if (enemy.type === 3) {
                    const healthPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100);
                    uiBossHpBar.style.width = healthPct + '%';
                }

                b.stopped = true;
                b.stopTime = 0;

                if (enemy.hp <= 0) {
                    enemy.state = 'dying';
                    enemy.deathTime = 0;
                    if (enemy.action) {
                        enemy.action.stop();
                    }
                    // Play death sound
                    const buf = enemy.type === 1 ? dieBuffer1 : (enemy.type === 2 ? dieBuffer2 : dieBuffer3);
                    if (buf && enemy.deathSound) {
                        enemy.deathSound.setBuffer(buf);
                        if (enemy.deathSound.isPlaying) enemy.deathSound.stop();
                        enemy.deathSound.play();
                    }
                }
                break;
            }
        }
    }
}

function teleportPlayerIfOob() {
    if (camera.position.y <= -25) {
        playerCollider.start.set(0, 0.35, 0);
        playerCollider.end.set(0, 1, 0);
        playerCollider.radius = 0.35;
        camera.position.copy(playerCollider.end);
        camera.rotation.set(0, 0, 0);
    }
}

function takeDamage(amount) {
    if (isGameOver) return;
    hp -= amount;
    if (hp <= 0) hp = 0;
    uiHp.style.width = Math.floor(hp) + '%';
    currentDamageIntensity = 2.0;

    if (hp === 0) {
        setGameOver(false);
    } else {
        playSound(Math.random() > 0.5 ? sounds.hurt1 : sounds.hurt2);
    }
}

function updateEnemies(deltaTime) {
    resolveEnemyEnemyCollisions();

    for (const enemy of enemyPool) {
        if (!enemy.active) continue;

        if (enemy.state === 'dying') {
            enemy.deathTime += deltaTime;

            if (enemy.deathTime < 0.3) {
                const scale = enemy.mesh.scale.x + Math.sin(enemy.deathTime * 360) * 0.02;
                enemy.mesh.scale.set(scale, scale, scale);
            }
            else {
                const scale = Math.max(0, enemy.mesh.scale.x - (enemy.deathTime * 0.1));
                enemy.mesh.scale.set(scale, scale, scale);
            }
            const emissiveVal = 4 + Math.sin(enemy.deathTime * 20) * 4;
            for (const child of enemy.meshChildren) {
                child.material.emissiveIntensity = emissiveVal;
            }

            if (enemy.deathTime > 0.5) {
                if (enemy.auraSound && enemy.auraSound.isPlaying) enemy.auraSound.stop();
                if (enemy.deathSound && enemy.deathSound.isPlaying) enemy.deathSound.stop();
                enemy.active = false;
                enemy.state = 'dead';
                enemy.mesh.visible = false;
                if (enemy.type === 3) {
                    uiBoss.style.display = 'none';
                    bossSpawned = false;
                    setGameOver(true);
                }
                if (enemy.type === 2) {
                    lastParamsMiniBossDeadTime = totalElapsed;
                }

            }
            continue;
        }

        enemy.timeAlive += deltaTime;

        _tempVec3C.subVectors(camera.position, enemy.mesh.position);
        _tempVec3C.y = 0;

        const distance = _tempVec3C.length();
        let targetSpeed = 0;

        if (distance > 1) {
            _tempVec3C.normalize();
            targetSpeed = enemy.speed;

            // Type 1: swarm by applying a lateral offset that shrinks as they get closer
            if (enemy.type === 1 && distance > 3) {
                const swarmStrength = Math.min(1.0, (distance - 3) / 10);
                const lateralX = -_tempVec3C.z * Math.sin(enemy.swarmAngle) * swarmStrength;
                const lateralZ = _tempVec3C.x * Math.sin(enemy.swarmAngle) * swarmStrength;
                _tempVec3C.x += lateralX;
                _tempVec3C.z += lateralZ;
                _tempVec3C.normalize();
            }

            enemy.mesh.position.addScaledVector(_tempVec3C, targetSpeed * deltaTime);
            enemy.mesh.lookAt(camera.position.x, enemy.mesh.position.y, camera.position.z);
        } else {
            if (totalElapsed - enemy.lastDamageToPlayerTime >= 1.0) {
                enemy.lastDamageToPlayerTime = totalElapsed;
                takeDamage(10);
            }
        }

        // Collide enemy with world geometry (walls)
        const eRadius = enemy.type === 3 ? 2.0 : (enemy.type === 2 ? 1.0 : 0.5);
        _tempSphere.set(enemy.mesh.position, eRadius);
        const wallHit = worldOctree.sphereIntersect(_tempSphere);
        if (wallHit) {
            enemy.mesh.position.add(wallHit.normal.multiplyScalar(wallHit.depth));
        }

        if (enemy.type === 2) {
            if (totalElapsed - enemy.lastAttackTime >= 3) {
                enemy.lastAttackTime = totalElapsed;
                _tempVec3D.lerpVectors(enemy.mesh.position, camera.position, 0.7);
                _tempVec3D.y = enemy.mesh.position.y;
                enemy.isDashing = true;
                enemy.dashTarget.copy(_tempVec3D);
                enemy.dashTimer = 0;
                playSound(sounds.dash);
            }
            if (enemy.isDashing) {
                enemy.dashTimer += deltaTime;
                enemy.mesh.position.lerp(enemy.dashTarget, deltaTime * 20);

                if (enemy.dashTimer > 0.3 || enemy.mesh.position.distanceToSquared(enemy.dashTarget) < 0.1) {
                    enemy.isDashing = false;
                }
            }
            const scaleAmt = 1.0 + Math.sin(totalElapsed * 2) * 0.2;
            enemy.mesh.scale.set(scaleAmt, scaleAmt, scaleAmt);
        }

        if (enemy.type === 3) {
            if (totalElapsed - enemy.lastAttackTime >= 3) {
                enemy.lastAttackTime = totalElapsed;
                const numBullets = 12;
                for (let b = 0; b < numBullets; b++) {
                    const bossBullet = getBossBullet();
                    if (!bossBullet) break;

                    bossBullet.active = true;
                    bossBullet.timeAlive = 0;
                    bossBullet.mesh.visible = true;

                    const angle = (b / numBullets) * Math.PI * 2;
                    _tempVec3C.set(Math.cos(angle), 0, Math.sin(angle));

                    bossBullet.mesh.position.copy(enemy.mesh.position);
                    bossBullet.mesh.position.addScaledVector(_tempVec3C, 3);
                    bossBullet.velocity.copy(_tempVec3C).multiplyScalar(15);
                }
            }
        }
    }
}

function updateEnemyBullets(deltaTime) {
    for (const b of bossBulletPool) {
        if (!b.active) continue;
        b.timeAlive += deltaTime;

        if (b.timeAlive > 5) {
            b.active = false;
            b.mesh.visible = false;
            continue;
        }

        b.mesh.position.addScaledVector(b.velocity, deltaTime);

        const distToPlayer = b.mesh.position.distanceTo(camera.position);
        if (distToPlayer < 2.0) {
            takeDamage(10);
            b.active = false;
            b.mesh.visible = false;
        }
    }
}

function updateSpawners() {
    if (totalElapsed - lastParamsSpawnTime > 2.5) {
        lastParamsSpawnTime = totalElapsed;
        const x = THREE.MathUtils.randFloat(-5.5, 5.5);
        const y = THREE.MathUtils.randFloat(1, 1.2);
        const z = THREE.MathUtils.randFloat(-30, 3);
        spawnEnemy(1, new THREE.Vector3(x, y, z));
    }

    const hasMiniBoss = enemyPool.some(e => e.type === 2 && e.active);
    if (totalElapsed > 15 && !hasMiniBoss && (totalElapsed - lastParamsMiniBossDeadTime) > 50) {
        spawnEnemy(2, new THREE.Vector3(0, 2, 20));
    }

    if (totalElapsed > 60 && !bossSpawned) {
        spawnEnemy(3, new THREE.Vector3(0, 2, -15));
        bossSpawned = true;
        uiBoss.style.display = 'block';
        uiBossHpBar.style.width = '100%';
    }
}

let isDamagingRange = false;

function updateAudioStates() {
    let inRange = false;
    for (const enemy of enemyPool) {
        if (!enemy.active || enemy.state === 'dying') continue;
        const distSq = camera.position.distanceToSquared(enemy.mesh.position);
        const radius = enemy.type === 3 ? 3 : (enemy.type === 2 ? 1 : 0.8);
        if (distSq < (radius + 0.2) * (radius + 0.2)) {
            inRange = true;
            break;
        }
    }

    if (inRange && !isDamagingRange) {
        sounds.damaging.setLoop(true);
        if (!sounds.damaging.isPlaying) sounds.damaging.play();
        isDamagingRange = true;
    } else if (!inRange && isDamagingRange) {
        sounds.damaging.setLoop(false);
        isDamagingRange = false;
    }
}

function animate() {
    let delta = clock.getDelta();
    for (let mixer of mixers) {
        mixer.update(delta);
    }

    if (currentDamageIntensity > 0) {
        currentDamageIntensity -= delta * 1.0;
        if (currentDamageIntensity < 0) currentDamageIntensity = 0;
    }
    damagePass.uniforms['damageIntensity'].value = currentDamageIntensity;

    const frameDelta = Math.min(0.05, delta);
    const physicsDelta = frameDelta / STEPS_PER_FRAME;

    if (!isGameOver) {
        for (let i = 0; i < STEPS_PER_FRAME; i++) {
            controls(physicsDelta);
            updatePlayer(physicsDelta);
            teleportPlayerIfOob();
        }
        totalElapsed += frameDelta;
        if (isMouseDown) tryShoot();

        updateGunAndBullets(frameDelta);
        updateEnemies(frameDelta);
        updateEnemyBullets(frameDelta);
        updateSpawners();
        updateAudioStates();
    }

    // Keep updating impacts even if game over
    updateImpacts(frameDelta);
    //updateTrails();

    composer.render();
}

// renderer.setAnimationLoop(animate);
