(() => {
  "use strict";

  /* ------------------------------------------------------------------
   * 1. SHADER
   * Un solo fragment shader dibuja todo: fondo, brillo, blob y grano.
   * El blob es un campo de distancia (SDF): hasta 3 circulos fusionados
   * con "smooth min" + una caja redondeada, deformados con ruido fbm.
   * ------------------------------------------------------------------ */
  const VERT = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;

    uniform vec2  u_res;
    uniform float u_time;
    uniform vec2  u_mouse;
    uniform float u_pulse; // 0 en reposo, 1 en mitad de la transicion

    uniform vec3 u_b[3];   // x, y, radio de cada esfera
    uniform vec3 u_w;      // peso (0 = apagada, 1 = activa)
    uniform vec4 u_shape;  // fusion, mezcla caja, medio lado caja, radio esquina
    uniform vec4 u_look;   // suavidad borde, ondulacion, fuerza luz, ancho luz
    uniform vec4 u_look2;  // luz envolvente, sombra, halo, grano
    uniform vec4 u_dirs;   // direccion luz (xy), direccion fondo (zw)

    uniform vec3 u_bg1, u_bg2, u_c1, u_c2, u_c3, u_rim, u_glow;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec2(17.1, 9.2);
        a *= 0.5;
      }
      return v;
    }

    float smin(float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
    }

    float sdBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    // Distancia con signo al blob (negativa dentro)
    float map(vec2 p) {
      float t = u_time;
      float k = max(u_shape.x, 0.001);
      float d = 1e3;

      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 c = u_b[i].xy + 0.05 * vec2(sin(t * 0.55 + fi * 2.1), cos(t * 0.47 + fi * 1.7));
        float r = u_b[i].z * (1.0 + 0.04 * sin(t * 0.8 + fi * 3.0));
        float bd = length(p - c) - r;
        bd += (1.0 - u_w[i]) * 4.0;
        d = (i == 0) ? bd : smin(d, bd, k);
      }

      float box = sdBox(p, vec2(u_shape.z), u_shape.w);
      d = mix(d, box, u_shape.y);

      // Ondulacion organica
      d += (u_look.y + u_pulse * 0.05) * (fbm(p * 1.7 + vec2(t * 0.12, -t * 0.09)) - 0.5);
      return d;
    }

    void main() {
      // Coordenadas centradas: el lado corto va de -1 a 1
      vec2 bp = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
      vec2 p  = bp - u_mouse * 0.07;

      // Fondo: degradado direccional + vineta
      vec2 bdir = normalize(u_dirs.zw + 1e-4);
      float g = clamp(0.5 + 0.4 * dot(bp, bdir), 0.0, 1.0);
      vec3 bg = mix(u_bg1, u_bg2, smoothstep(0.0, 1.0, g));
      bg *= 1.0 - 0.28 * smoothstep(0.7, 2.1, length(bp));

      float d = map(p);

      // Halo exterior
      bg += u_glow * (u_look2.z + u_pulse * 0.35) * exp(-max(d, 0.0) * (5.5 - 2.5 * u_pulse)) * 0.75;

      float soft = max(u_look.x, 0.004) + u_pulse * 0.11;
      float m = 1.0 - smoothstep(-soft, soft, d);
      vec3 outc = bg;

      if (m > 0.001) {
        vec2 L = normalize(u_dirs.xy + u_mouse * 0.5 + 1e-4);

        // Normal aproximada del campo de distancia
        vec2 e = vec2(0.012, 0.0);
        vec2 n = normalize(vec2(
          map(p + e.xy) - map(p - e.xy),
          map(p + e.yx) - map(p - e.yx)
        ) + 1e-5);

        // Color interior: ruido con dominio deformado (dos capas)
        vec2 q = p * 1.3;
        float t = u_time * 0.15;
        vec2 w = vec2(fbm(q + t), fbm(q + vec2(5.2, 1.3) - t));
        float f1 = fbm(q + 2.0 * w + t);
        float f2 = fbm(q * 0.8 + 3.0 * w.yx - t + vec2(8.0, 2.0));

        vec3 col = mix(u_c1, u_c2, smoothstep(0.25, 0.75, f1));
        col = mix(col, u_c3, smoothstep(0.40, 0.85, f2) * 0.85);

        // Volumen: mas claro hacia la luz, ligeramente apagado en el borde
        col *= 1.0 + 0.22 * dot(p, L);
        col = mix(col, col * 0.86, smoothstep(-0.35, 0.0, d));

        // Durante la transicion el color interior se difumina
        col = mix(col, mix(u_c1, u_c2, 0.5), u_pulse * 0.4);

        // Borde de luz (rim light)
        float ew   = max(u_look.w, 0.02);
        float edge = smoothstep(-ew, 0.0, d);
        float lt   = mix(max(dot(n, L), 0.0), 1.0, u_look2.x);
        float rim  = edge * edge * pow(lt, 1.4) * u_look.z * (1.0 - 0.7 * u_pulse);
        col = mix(col, u_rim, clamp(rim, 0.0, 1.0));

        // Sombra interior opuesta a la luz
        col *= 1.0 - u_look2.y * smoothstep(-0.45, 0.0, d) * max(dot(n, -L), 0.0) * 0.8;

        outc = mix(bg, col, m);
      }

      // Grano de pelicula
      outc += (hash(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5) * u_look2.w;

      gl_FragColor = vec4(outc, 1.0);
    }
  `;

  /* ------------------------------------------------------------------
   * 2. PRESETS
   * Cada preset es solo un conjunto de numeros. Al cambiar de preset
   * se interpolan todos, y de ahi sale el morphing entre formas.
   * ------------------------------------------------------------------ */
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  const make = (o) => ({
    // [x, y, radio] x 3 esferas
    // Las esferas que faltan se copian de la primera: al cambiar de preset
    // se separan o se funden con el cuerpo en lugar de aparecer y desaparecer.
    b: [...o.balls[0], ...(o.balls[1] || o.balls[0]), ...(o.balls[2] || o.balls[1] || o.balls[0])],
    w: [1, 1, 1],
    shape: [o.merge ?? (o.balls.length > 1 ? 0.2 : 0.02), o.box ?? 0, o.boxHalf ?? 0.45, o.boxR ?? 0.14],
    look: [o.soft ?? 0.03, o.wobble ?? 0.06, o.rim ?? 0.8, o.rimWidth ?? 0.12],
    look2: [o.rimAround ?? 0, o.shadow ?? 0, o.glow ?? 0.5, o.grain ?? 0.035],
    dirs: [...(o.light ?? [0.7, 0.7]), ...(o.bgDir ?? [0, -1])],
    bg1: rgb(o.bg[0]),
    bg2: rgb(o.bg[1]),
    c1: rgb(o.colors[0]),
    c2: rgb(o.colors[1]),
    c3: rgb(o.colors[2]),
    rimC: rgb(o.rimColor ?? "#ffffff"),
    glowC: rgb(o.glowColor ?? "#000000"),
  });

  const PRESETS = {
    twinMoons: make({
      balls: [[-0.3, 0.1, 0.37], [0.3, -0.08, 0.33]],
      merge: 0.32, soft: 0.02, wobble: 0.04,
      bg: ["#0b0932", "#6f5b8c"], bgDir: [0, -1],
      colors: ["#ffc2f4", "#9a6bff", "#4a3fd8"],
      rimColor: "#ffe3ff", rim: 0.7, rimWidth: 0.12, light: [-0.6, -0.7],
      glowColor: "#8a6bff", glow: 0.45,
    }),
    eclipse: make({
      balls: [[-0.27, 0.03, 0.33], [0.27, -0.03, 0.33]],
      merge: 0.3, soft: 0.07, wobble: 0.07,
      bg: ["#101744", "#070a22"], bgDir: [0.6, -0.8],
      colors: ["#3d6bff", "#9b7bff", "#e58cff"],
      rimColor: "#ff5fb4", rim: 0.7, rimWidth: 0.16, light: [0.8, 0.6],
      glowColor: "#5a4cff", glow: 0.8,
    }),
    seafoam: make({
      balls: [[0.0, 0.0, 0.58]],
      soft: 0.012, wobble: 0.025,
      bg: ["#dedfe0", "#232325"], bgDir: [-0.9, 0.7],
      colors: ["#ffffff", "#f1f1f1", "#dadada"],
      rimColor: "#2b2224", rim: 0.95, rimWidth: 0.07, rimAround: 1, shadow: 0.9,
      light: [-0.7, 0.7], glow: 0.0,
    }),
    iris: make({
      balls: [[0.0, 0.3, 0.3], [-0.26, -0.15, 0.3], [0.26, -0.15, 0.3]],
      merge: 0.3, soft: 0.04, wobble: 0.05,
      bg: ["#cdd7d4", "#05414a"], bgDir: [0, -1],
      colors: ["#eaffff", "#7ff0e6", "#22b5b2"],
      rimColor: "#ffe35e", rim: 0.85, rimWidth: 0.08, light: [0.9, 0.5],
      glowColor: "#3fd0c8", glow: 0.25,
    }),
    nightWindow: make({
      balls: [[0, 0, 0.3]],
      box: 1, boxHalf: 0.5, boxR: 0.17, soft: 0.05, wobble: 0.04,
      bg: ["#00226a", "#000a2c"], bgDir: [0, -1],
      colors: ["#8b6cff", "#ff82d2", "#3547c9"],
      rimColor: "#c2b0ff", rim: 0.65, rimWidth: 0.14, light: [0.6, 0.8],
      glowColor: "#1a52ff", glow: 0.9,
    }),
    sageStone: make({
      balls: [[-0.1, -0.02, 0.4], [0.17, 0.1, 0.34]],
      merge: 0.32, soft: 0.012, wobble: 0.045,
      bg: ["#bcc7b1", "#9db09b"], bgDir: [0.4, -0.9],
      colors: ["#ffffff", "#efe8dc", "#cfcac0"],
      rimColor: "#ffd9a2", rim: 0.9, rimWidth: 0.1, rimAround: 0.15, light: [0.7, 0.7],
      glow: 0.0, grain: 0.03,
    }),
    goldLeaf: make({
      balls: [[0.0, 0.04, 0.56]],
      soft: 0.075, wobble: 0.12,
      bg: ["#2c2c2e", "#121213"], bgDir: [0, -1],
      colors: ["#f4f4f1", "#9c9c9a", "#262627"],
      rimColor: "#eaa93a", rim: 1.0, rimWidth: 0.2, light: [0.0, 1.0],
      glowColor: "#3a2b10", glow: 0.25,
    }),
    supernova: make({
      balls: [[0.0, 0.0, 0.6]],
      soft: 0.012, wobble: 0.05,
      bg: ["#2a0712", "#05030a"], bgDir: [0.7, 0.7],
      colors: ["#00e5ff", "#b020ff", "#ff2a55"],
      rimColor: "#ff63de", rim: 0.75, rimWidth: 0.1, rimAround: 0.3, light: [-0.4, -0.9],
      glowColor: "#ff1a2e", glow: 1.0, grain: 0.04,
    }),
  };

  // uniforma GLSL -> clave en el estado
  const UNIFORMS = {
    "u_b[0]": ["b", 3], u_w: ["w", 3],
    u_shape: ["shape", 4], u_look: ["look", 4], u_look2: ["look2", 4], u_dirs: ["dirs", 4],
    u_bg1: ["bg1", 3], u_bg2: ["bg2", 3],
    u_c1: ["c1", 3], u_c2: ["c2", 3], u_c3: ["c3", 3],
    u_rim: ["rimC", 3], u_glow: ["glowC", 3],
  };

  const clone = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.slice()]));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  // Con un pequeno rebote al final: la forma "asienta" en su posicion
  const easeBack = (t) => {
    const c1 = 1.1, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const smooth = (a, b, t) => {
    const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
    return x * x * (3 - 2 * x);
  };
  // Los colores se mezclan por otra curva que la forma
  const COLOR_KEYS = new Set(["bg1", "bg2", "c1", "c2", "c3", "rimC", "glowC"]);

  /* ------------------------------------------------------------------
   * 3. WEBGL
   * ------------------------------------------------------------------ */
  const canvas = document.getElementById("stage");
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });

  if (!gl) {
    document.getElementById("fallback").hidden = false;
    return;
  }

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
    }
    return sh;
  };

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // Un triangulo gigante que cubre toda la pantalla
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const loc = {};
  ["u_res", "u_time", "u_mouse", "u_pulse", ...Object.keys(UNIFORMS)].forEach((n) => {
    loc[n] = gl.getUniformLocation(prog, n);
  });

  const setters = { 3: "uniform3fv", 4: "uniform4fv" };

  const upload = (state) => {
    for (const [name, [key, size]] of Object.entries(UNIFORMS)) {
      gl[setters[size]](loc[name], state[key]);
    }
  };

  /* ------------------------------------------------------------------
   * 4. ESTADO, TRANSICIONES E INTERACCION
   * ------------------------------------------------------------------ */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const DURATION = 1150; // ms

  const names = Object.keys(PRESETS);
  const hashName = location.hash.slice(1);
  let currentName = names.includes(hashName) ? hashName : names[0];

  let state = clone(PRESETS[currentName]);
  let from = clone(state);
  let target = PRESETS[currentName];
  let tStart = -Infinity;
  let pulse = 0;      // cuanto desenfoque hay ahora mismo
  let pulseFrom = 0;  // desenfoque con el que empezo la transicion actual

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let time = 0;
  let last = performance.now();

  const goTo = (name) => {
    if (!PRESETS[name] || name === currentName) return;
    currentName = name;
    from = clone(state);
    pulseFrom = pulse;
    target = PRESETS[name];
    tStart = performance.now();
    if (reduceMotion.matches) tStart = -Infinity;
    history.replaceState(null, "", "#" + name);
    syncDock();
  };

  const stepTransition = (now) => {
    const raw = Math.min(Math.max((now - tStart) / DURATION, 0), 1);
    const kShape = easeBack(raw);
    const kColor = smooth(0.08, 0.92, raw);

    for (const key in state) {
      const k = COLOR_KEYS.has(key) ? kColor : kShape;
      const a = from[key], b = target[key], out = state[key];
      for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
    }

    // Campana: 0 -> 1 en la mitad -> 0. Si se interrumpe una transicion,
    // se parte del desenfoque actual para que no haya saltos.
    pulse = Math.max(pulseFrom * (1 - raw), Math.sin(Math.PI * raw));
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(loc.u_res, w, h);
  };

  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt * (reduceMotion.matches ? 0.2 : 1);

    stepTransition(now);

    // El puntero se sigue con suavizado
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;

    resize();
    upload(state);
    gl.uniform1f(loc.u_time, time);
    gl.uniform1f(loc.u_pulse, pulse);
    gl.uniform2f(loc.u_mouse, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  };

  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  /* ------------------------------------------------------------------
   * 5. BARRA DE PRESETS
   * ------------------------------------------------------------------ */
  const dock = document.getElementById("dock");
  const thumb = document.getElementById("thumb");
  const buttons = [...dock.querySelectorAll(".dock__btn")];

  function syncDock() {
    buttons.forEach((b) => {
      const on = b.dataset.preset === currentName;
      b.setAttribute("aria-pressed", String(on));
      if (on) {
        thumb.style.setProperty("--thumb-x", b.offsetLeft + "px");
        thumb.style.setProperty("--thumb-w", b.offsetWidth + "px");
        const left = b.offsetLeft - (dock.clientWidth - b.offsetWidth) / 2;
        dock.scrollTo({ left, behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
    });
  }

  dock.addEventListener("click", (e) => {
    const btn = e.target.closest(".dock__btn");
    if (btn) goTo(btn.dataset.preset);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = names.indexOf(currentName);
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + names.length) % names.length;
    goTo(names[next]);
  });

  window.addEventListener("resize", syncDock);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncDock);

  // Posicion inicial sin animar el indicador
  thumb.style.transition = "none";
  syncDock();
  requestAnimationFrame(() => (thumb.style.transition = ""));

  requestAnimationFrame(frame);
})();