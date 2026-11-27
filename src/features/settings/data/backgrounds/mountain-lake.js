// Original Bycoda example. Three.js r180 is bundled offline under its MIT license.
(() => {
  const T = globalThis.THREE;
  const host = document.querySelector("#scene");
  let renderer,
    reflection,
    frame = 0,
    disposed = false,
    last = 0,
    rendered = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const resources = new Set();
  let release;
  const keep = (value) => {
    resources.add(value);
    return value;
  };
  const proof = (globalThis.__BYCODA_SCENE_PROOF__ = {
    engine: "Three.js",
    revision: T.REVISION,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    disposed: false,
  });
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.append(renderer.domElement);
    const scene = new T.Scene();
    scene.fog = new T.Fog("#948eac", 35, 135);
    const camera = new T.PerspectiveCamera(48, 1, 0.3, 260);
    camera.position.set(0, 6.4, 22);
    camera.lookAt(0, 3.4, -32);

    const sky = new T.Mesh(
      keep(new T.SphereGeometry(190, 40, 24)),
      keep(
        new T.ShaderMaterial({
          side: T.BackSide,
          depthWrite: false,
          uniforms: {
            top: { value: new T.Color("#24426c") },
            horizon: { value: new T.Color("#f3a173") },
          },
          vertexShader:
            "varying vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
          fragmentShader:
            `uniform vec3 top;uniform vec3 horizon;varying vec3 vPosition;void main(){float h=normalize(vPosition).y;vec3 col=mix(horizon,top,smoothstep(-.05,.35,h));gl_FragColor=vec4(col,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(
              ";#include",
              ";\n#include",
            ),
        }),
      ),
    );
    sky.frustumCulled = false;
    scene.add(sky);
    scene.add(new T.HemisphereLight("#bec7e0", "#293e3b", 1.7));
    const sunLight = new T.DirectionalLight("#ffd2a1", 2.4);
    sunLight.position.set(-35, 22, -30);
    scene.add(sunLight);
    const sun = new T.Mesh(
      keep(new T.SphereGeometry(2.3, 40, 24)),
      keep(new T.MeshBasicMaterial({ color: "#ffe3b8", fog: false })),
    );
    sun.position.set(-29, 27, -125);
    scene.add(sun);

    const noise = (x, z) =>
      Math.sin(x * 0.39 + z * 0.16) * 0.55 +
      Math.sin(x * 0.83 - z * 0.28) * 0.28 +
      Math.cos(x * 1.79 + z * 0.7) * 0.17;
    function mountain(z, height, width, color, seed) {
      const depth = 50;
      const geometry = keep(new T.PlaneGeometry(width, depth, 140, 48));
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      const colors = [];
      const low = new T.Color(color),
        snow = new T.Color("#e7d3d1");
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i),
          localZ = positions.getZ(i),
          v = (localZ + depth / 2) / depth;
        const ridge =
          height *
          (0.63 +
            0.22 * Math.sin(x * 0.065 + seed) +
            0.16 * Math.sin(x * 0.17 + seed) +
            0.12 * noise(x, seed));
        const slope = Math.pow(Math.max(0, Math.sin(v * Math.PI)), 0.85);
        const valley = 1 - 0.25 * Math.exp((-x * x) / 100);
        const y =
          slope * Math.max(2, ridge) * valley + slope * noise(x * 0.7, localZ * 0.8 + seed) * 1.8;
        positions.setXYZ(i, x, y - 1, z + localZ);
        const tint = low.clone().lerp(snow, Math.max(0, (y / height - 0.56) * 2.1));
        tint.multiplyScalar(0.83 + noise(x, v * 19) * 0.14);
        colors.push(tint.r, tint.g, tint.b);
      }
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      scene.add(
        new T.Mesh(
          geometry,
          keep(
            new T.MeshStandardMaterial({
              vertexColors: true,
              roughness: 1,
              side: T.DoubleSide,
              flatShading: true,
            }),
          ),
        ),
      );
    }
    mountain(-116, 27, 190, "#9693ae", 2);
    mountain(-91, 31, 165, "#687e95", 5);
    mountain(-69, 21, 140, "#405d71", 8);
    mountain(-54, 12, 120, "#294e59", 13);

    function shore(side) {
      const points = [],
        colors = [],
        indices = [];
      const dark = new T.Color("#203e3b"),
        grass = new T.Color("#3e6252");
      for (let i = 0; i <= 75; i++) {
        const z = 23 - i * 1.15;
        const edge = side * (9 + Math.sin(z * 0.08 + side * 2) * 3 + Math.cos(z * 0.19) * 1.2);
        for (let j = 0; j <= 5; j++) {
          const x = edge + side * j * 4;
          const y = j === 0 ? -0.05 : 0.3 + j * 0.3 + noise(x, z) * 0.5;
          points.push(x, y, z);
          const c = dark.clone().lerp(grass, j / 12);
          colors.push(c.r, c.g, c.b);
          if (i < 75 && j < 5) {
            const a = i * 6 + j;
            indices.push(a, a + 6, a + 1, a + 1, a + 6, a + 7);
          }
        }
      }
      const geometry = keep(new T.BufferGeometry());
      geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      scene.add(
        new T.Mesh(
          geometry,
          keep(
            new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: T.DoubleSide }),
          ),
        ),
      );
    }
    shore(-1);
    shore(1);
    const treeCount = 340;
    const leafGeometry = keep(new T.ConeGeometry(1, 3, 6));
    const trunkGeometry = keep(new T.CylinderGeometry(0.07, 0.12, 2.6, 5));
    const trunks = new T.InstancedMesh(
      trunkGeometry,
      keep(new T.MeshStandardMaterial({ color: "#382f30", roughness: 1 })),
      treeCount,
    );
    const leaves = new T.InstancedMesh(
      leafGeometry,
      keep(new T.MeshStandardMaterial({ color: "#183b37", roughness: 1 })),
      treeCount * 3,
    );
    const transform = new T.Object3D();
    for (let i = 0; i < treeCount; i++) {
      const side = i % 2 ? 1 : -1;
      const random = Math.sin(i * 127.1 + 32.7) * 43758.5453;
      const fraction = random - Math.floor(random);
      const z = 18 - (Math.floor(i / 2) / (treeCount / 2)) * 76;
      const edge = 9 + Math.sin(z * 0.08 + side * 2) * 3 + Math.cos(z * 0.19) * 1.2;
      const x = side * (edge + 1.4 + fraction * 15);
      const scale = 0.65 + fraction * 0.9 + (z > 8 ? 0.7 : 0);
      transform.position.set(x, 0.7 + scale, z);
      transform.scale.set(scale, scale, scale);
      transform.updateMatrix();
      trunks.setMatrixAt(i, transform.matrix);
      for (let level = 0; level < 3; level++) {
        transform.position.set(x, 0.8 + scale * (1.7 + level * 1.05), z);
        const width = scale * (1 - level * 0.18);
        transform.scale.set(width, scale * 0.85, width);
        transform.updateMatrix();
        leaves.setMatrixAt(i * 3 + level, transform.matrix);
      }
    }
    scene.add(trunks, leaves);
    reflection = new T.Reflector(keep(new T.PlaneGeometry(180, 220)), {
      textureWidth: Math.min(1024, Math.max(256, innerWidth)),
      textureHeight: Math.min(768, Math.max(256, innerHeight)),
      clipBias: 0.002,
      multisample: 0,
      shader: {
        uniforms: {
          tDiffuse: { value: null },
          textureMatrix: { value: new T.Matrix4() },
          time: { value: 0 },
          color: { value: new T.Color("#426f77") },
        },
        vertexShader:
          "uniform mat4 textureMatrix;varying vec4 vUv;varying vec3 vWorld;void main(){vUv=textureMatrix*vec4(position,1.);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          `uniform sampler2D tDiffuse;uniform float time;uniform vec3 color;varying vec4 vUv;varying vec3 vWorld;void main(){vec2 uv=vUv.xy/vUv.w;float ripple=sin(vWorld.x*1.8+vWorld.z*.6+time*.45)*.0009+sin(vWorld.z*2.4-time*.3)*.0005;uv.y+=ripple;vec3 reflected=texture2D(tDiffuse,uv).rgb;float glint=pow(max(0.,sin(vWorld.z*2.2+vWorld.x*.8+time*.24)),24.)*.003;vec3 col=mix(color*.24,reflected,.74)+glint;gl_FragColor=vec4(col,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(
            ";#include",
            ";\n#include",
          ),
      },
    });
    reflection.rotation.x = -Math.PI / 2;
    reflection.position.set(0, 0, -25);
    scene.add(reflection);

    function resize() {
      const scale = Math.min(1, 1920 / Math.max(1, innerWidth), 1080 / Math.max(1, innerHeight));
      const width = Math.max(1, Math.round(innerWidth * scale)),
        height = Math.max(1, Math.round(innerHeight * scale));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render(0);
    }
    function render(time) {
      if (disposed) return;
      reflection.material.uniforms.time.value = time * 0.001;
      renderer.render(scene, camera);
      proof.frames = ++rendered;
      proof.drawCalls = renderer.info.render.calls;
      proof.triangles = renderer.info.render.triangles;
      document.body.dataset.webglReady = "true";
    }
    function loop(now) {
      frame = 0;
      if (disposed || document.hidden || reduced.matches) return;
      if (now - last >= 1000 / 30) {
        render(now);
        last = now;
      }
      frame = requestAnimationFrame(loop);
    }
    function syncMotion() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!document.hidden && !disposed) {
        render(0);
        if (!reduced.matches) frame = requestAnimationFrame(loop);
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", syncMotion);
      reduced.removeEventListener("change", syncMotion);
      reflection.dispose();
      resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      proof.disposed = true;
    }
    release = dispose;
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", syncMotion);
    reduced.addEventListener("change", syncMotion);
    window.addEventListener("pagehide", dispose, { once: true });
    renderer.domElement.addEventListener(
      "webglcontextlost",
      () => {
        cancelAnimationFrame(frame);
        host.dataset.failed = "true";
      },
      { once: true },
    );
    resize();
    syncMotion();
  } catch (error) {
    if (release) release();
    else {
      reflection?.dispose();
      resources.forEach((resource) => resource.dispose());
      renderer?.dispose();
      renderer?.forceContextLoss();
      proof.disposed = true;
    }
    host.textContent = "3D preview unavailable on this device.";
    host.dataset.failed = "true";
    proof.error = String(error);
  }
})();
