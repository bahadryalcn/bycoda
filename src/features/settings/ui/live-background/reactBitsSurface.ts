import type { LiveBackgroundPalette, LiveSignal } from "./types";

/** Adapted from David Haz / React Bits, copyright (c) 2026 David Haz.
 * https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/Threads
 * https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/Silk
 * https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/DarkVeil
 * https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/SoftAurora
 * https://github.com/DavidHDev/react-bits/tree/main/src/content/Backgrounds/FloatingLines
 * License: vendor/react-bits/LICENSE.md. Integrated product artwork only.
 * Upstream geometry, fold equations, CPPN and noise functions are retained; React,
 * interaction listeners, framebuffer passes and bloom are intentionally absent. */

export type ReactBitsSurfaceKind =
  | "threads"
  | "silk"
  | "dark-veil"
  | "soft-aurora"
  | "floating-lines";
export type ReactBitsSurface = {
  resize(width: number, height: number, ratio: number): void;
  draw(time: number, delta: number, signal: LiveSignal): void;
  dispose(): void;
};

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const MAX_DPR = 1.25;
const THREAD_COUNT = 72;
const THREAD_SEGMENTS = 192;

const THREAD_VERTEX = `#version 300 es
precision highp float;
in vec2 aPoint;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPresence;
uniform float uEnergy;
out float vEdge;
out float vBand;
out float vIndex;
float Perlin2D(vec2 P) {
  vec2 Pi = floor(P);
  vec4 Pf_Pfmin1 = P.xyxy - vec4(Pi, Pi + 1.0);
  vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
  Pt = Pt - floor(Pt * (1.0 / 71.0)) * 71.0;
  Pt += vec2(26.0, 161.0).xyxy;
  Pt *= Pt;
  Pt = Pt.xzxz * Pt.yyww;
  vec4 hash_x = fract(Pt * (1.0 / 951.135664));
  vec4 hash_y = fract(Pt * (1.0 / 642.949883));
  vec4 grad_x = hash_x - 0.49999;
  vec4 grad_y = hash_y - 0.49999;
  vec4 results = inversesqrt(grad_x * grad_x + grad_y * grad_y) *
    (grad_x * Pf_Pfmin1.xzxz + grad_y * Pf_Pfmin1.yyww);
  results *= 1.4142135623730950;
  vec2 blend = Pf_Pfmin1.xy * Pf_Pfmin1.xy * Pf_Pfmin1.xy *
    (Pf_Pfmin1.xy * (Pf_Pfmin1.xy * 6.0 - 15.0) + 10.0);
  vec4 blend2 = vec4(blend, vec2(1.0 - blend));
  return dot(results, blend2.zxzx * blend2.wwyy);
}
void main() {
  float perc = float(gl_InstanceID) / ${THREAD_COUNT.toFixed(1)};
  float x = aPoint.x;
  float t = uTime / 10.0;
  float split = 0.03 + perc * 0.42;
  float amplitude = smoothstep(split, max(0.7, split + 0.2), x);
  float n = mix(
    Perlin2D(vec2(t * 2.5, (x * 1.05 + perc) * 2.5)),
    Perlin2D(vec2(t * 3.5, (x * 1.05 + t) * 3.5)) / 1.5,
    x * 0.3
  );
  float y = 0.5 + (perc - 0.5) * 0.92 +
    n * amplitude * (0.36 + 0.16 * uPresence + 0.1 * uEnergy);
  vec2 local = vec2((x - 0.5) * uResolution.x * 1.5,
                    (y - 0.5) * uResolution.y * 1.8);
  float thickness = (0.85 + 0.35 * uPresence + 0.15 * uEnergy) * (1.0 - perc * 0.45);
  float drawWidth = max(thickness, 1.0);
  local.y += aPoint.y * drawWidth;
  float angle = 0.26;
  vec2 turned = vec2(local.x * cos(angle) - local.y * sin(angle),
                     local.x * sin(angle) + local.y * cos(angle));
  gl_Position = vec4(turned / (uResolution * 0.5), 0.0, 1.0);
  vEdge = aPoint.y * drawWidth;
  vBand = drawWidth;
  vIndex = perc;
}`;

const THREAD_FRAGMENT = `#version 300 es
precision highp float;
in float vEdge;
in float vBand;
in float vIndex;
uniform vec2 uResolution;
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uPresence;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float center = exp(-pow((uv.x - 0.5) / 0.3, 2.0));
  float coverage = 1.0 - smoothstep(0.0, vBand, abs(vEdge));
  float taper = 1.0 - 0.55 * pow(vIndex, 0.6);
  float alpha = coverage * taper * (0.58 + 0.18 * uPresence) * (1.0 - center * 0.7);
  vec3 color = mix(uContent, uAccent, 0.15 + 0.5 * vIndex);
  outColor = vec4(color * alpha, alpha);
}`;

const SILK_VERTEX = `#version 300 es
in vec2 aPoint;
void main() { gl_Position = vec4(aPoint, 0.0, 1.0); }`;

const SILK_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uTime;
uniform float uPresence;
uniform float uEnergy;
out vec4 outColor;
vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c) * uv;
}
float silk(vec2 vUv) {
  vec2 uv = rotateUvs(vUv * 1.12, -0.35);
  vec2 tex = uv * 1.12;
  tex.y += 0.03 * (0.75 + uPresence * 0.35 + uEnergy * 0.4) * sin(8.0 * tex.x - uTime);
  return 0.6 + 0.4 * sin(5.0 * (tex.x + tex.y +
    cos(3.0 * tex.x + 5.0 * tex.y) + 0.02 * uTime) +
    (0.75 + 0.3 * uPresence + 0.2 * uEnergy) * sin(20.0 * (tex.x + tex.y - 0.1 * uTime)));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 coord = vec2((uv.x - 0.5) * uResolution.x / uResolution.y + 0.5, uv.y);
  float pattern = silk(coord);
  float n = clamp((pattern - 0.2) / 0.8, 0.0, 1.0);
  vec2 stepSize = vec2(1.0) / uResolution;
  float gx = silk(coord + vec2(stepSize.x, 0.0)) - pattern;
  float gy = silk(coord + vec2(0.0, stepSize.y)) - pattern;
  vec3 normal = normalize(vec3(-gx * 26.0, -gy * 26.0, 1.0));
  vec3 light = normalize(vec3(-0.55, 0.7, 0.85));
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float gloss = pow(max(dot(normal, halfway), 0.0), 48.0) * smoothstep(0.25, 0.85, n);
  float sheen = clamp(pow(n, 5.0) * 0.65 + gloss * 0.4, 0.0, 1.0);
  float center = exp(-pow((uv.x - 0.5) / 0.28, 2.0));
  float alpha = (0.14 + n * 0.25 + sheen * 0.22) *
    (1.0 - center * 0.72) * (0.85 + uPresence * 0.15);
  vec3 color = mix(uContent, uAccent, 0.18 + sheen * 0.28);
  outColor = vec4(color * alpha, alpha);
}`;

// Original trained CPPN weights, retained verbatim from React Bits DarkVeil.
const DARK_VEIL_CPPN = `vec4 sigmoid(vec4 x) {
  return 1.0 / (1.0 + exp(-x));
}

vec4 cppn(vec2 coordinate, vec3 latent) {
  vec4 buf[8];
  buf[6]=vec4(coordinate.x,coordinate.y,latent.x,latent.y);
  buf[7]=vec4(latent.z,sqrt(coordinate.x*coordinate.x+coordinate.y*coordinate.y),0.,0.);
  buf[0]=mat4(vec4(6.5404263,-3.6126034,0.7590882,-1.13613),vec4(2.4582713,3.1660357,1.2219609,0.06276096),vec4(-5.478085,-6.159632,1.8701609,-4.7742867),vec4(6.039214,-5.542865,-0.90925294,3.251348))*buf[6]+mat4(vec4(0.8473259,-5.722911,3.975766,1.6522468),vec4(-0.24321538,0.5839259,-1.7661959,-5.350116),vec4(0.,0.,0.,0.),vec4(0.,0.,0.,0.))*buf[7]+vec4(0.21808943,1.1243913,-1.7969975,5.0294676);
  buf[1]=mat4(vec4(-3.3522482,-6.0612736,0.55641043,-4.4719114),vec4(0.8631464,1.7432913,5.643898,1.6106541),vec4(2.4941394,-3.5012043,1.7184316,6.357333),vec4(3.310376,8.209261,1.1355612,-1.165539))*buf[6]+mat4(vec4(5.24046,-13.034365,0.009859298,15.870829),vec4(2.987511,3.129433,-0.89023495,-1.6822904),vec4(0.,0.,0.,0.),vec4(0.,0.,0.,0.))*buf[7]+vec4(-5.9457836,-6.573602,-0.8812491,1.5436668);
  buf[0]=sigmoid(buf[0]);buf[1]=sigmoid(buf[1]);
  buf[2]=mat4(vec4(-15.219568,8.095543,-2.429353,-1.9381982),vec4(-5.951362,4.3115187,2.6393783,1.274315),vec4(-7.3145227,6.7297835,5.2473326,5.9411426),vec4(5.0796127,8.979051,-1.7278991,-1.158976))*buf[6]+mat4(vec4(-11.967154,-11.608155,6.1486754,11.237008),vec4(2.124141,-6.263192,-1.7050359,-0.7021966),vec4(0.,0.,0.,0.),vec4(0.,0.,0.,0.))*buf[7]+vec4(-4.17164,-3.2281182,-4.576417,-3.6401186);
  buf[3]=mat4(vec4(3.1832156,-13.738922,1.879223,3.233465),vec4(0.64300746,12.768129,1.9141049,0.50990224),vec4(-0.049295485,4.4807224,1.4733979,1.801449),vec4(5.0039253,13.000481,3.3991797,-4.5561905))*buf[6]+mat4(vec4(-0.1285731,7.720628,-3.1425676,4.742367),vec4(0.6393625,3.714393,-0.8108378,-0.39174938),vec4(0.,0.,0.,0.),vec4(0.,0.,0.,0.))*buf[7]+vec4(-1.1811101,-21.621881,0.7851888,1.2329718);
  buf[2]=sigmoid(buf[2]);buf[3]=sigmoid(buf[3]);
  buf[4]=mat4(vec4(5.214916,-7.183024,2.7228765,2.6592617),vec4(-5.601878,-25.3591,4.067988,0.4602802),vec4(-10.57759,24.286327,21.102104,37.546658),vec4(4.3024497,-1.9625226,2.3458803,-1.372816))*buf[0]+mat4(vec4(-17.6526,-10.507558,2.2587414,12.462782),vec4(6.265566,-502.75443,-12.642513,0.9112289),vec4(-10.983244,20.741234,-9.701768,-0.7635988),vec4(5.383626,1.4819539,-4.1911616,-4.8444734))*buf[1]+mat4(vec4(12.785233,-16.345072,-0.39901125,1.7955981),vec4(-30.48365,-1.8345358,1.4542528,-1.1118771),vec4(19.872723,-7.337935,-42.941723,-98.52709),vec4(8.337645,-2.7312303,-2.2927687,-36.142323))*buf[2]+mat4(vec4(-16.298317,3.5471997,-0.44300047,-9.444417),vec4(57.5077,-35.609753,16.163465,-4.1534753),vec4(-0.07470326,-3.8656476,-7.0901804,3.1523974),vec4(-12.559385,-7.077619,1.490437,-0.8211543))*buf[3]+vec4(-7.67914,15.927437,1.3207729,-1.6686112);
  buf[5]=mat4(vec4(-1.4109162,-0.372762,-3.770383,-21.367174),vec4(-6.2103205,-9.35908,0.92529047,8.82561),vec4(11.460242,-22.348068,13.625772,-18.693201),vec4(-0.3429052,-3.9905605,-2.4626114,-0.45033523))*buf[0]+mat4(vec4(7.3481627,-4.3661838,-6.3037653,-3.868115),vec4(1.5462853,6.5488915,1.9701879,-0.58291394),vec4(6.5858274,-2.2180402,3.7127688,-1.3730392),vec4(-5.7973905,10.134961,-2.3395722,-5.965605))*buf[1]+mat4(vec4(-2.5132585,-6.6685553,-1.4029363,-0.16285264),vec4(-0.37908727,0.53738135,4.389061,-1.3024765),vec4(-0.70647055,2.0111287,-5.1659346,-3.728635),vec4(-13.562562,10.487719,-0.9173751,-2.6487076))*buf[2]+mat4(vec4(-8.645013,6.5546675,-6.3944063,-5.5933375),vec4(-0.57783127,-1.077275,36.91025,5.736769),vec4(14.283112,3.7146652,7.1452246,-4.5958776),vec4(2.7192075,3.6021907,-4.366337,-2.3653464))*buf[3]+vec4(-5.9000807,-4.329569,1.2427121,8.59503);
  buf[4]=sigmoid(buf[4]);buf[5]=sigmoid(buf[5]);
  buf[6]=mat4(vec4(-1.61102,0.7970257,1.4675229,0.20917463),vec4(-28.793737,-7.1390953,1.5025433,4.656581),vec4(-10.94861,39.66238,0.74318546,-10.095605),vec4(-0.7229728,-1.5483948,0.7301322,2.1687684))*buf[0]+mat4(vec4(3.2547753,21.489103,-1.0194173,-3.3100595),vec4(-3.7316632,-3.3792162,-7.223193,-0.23685838),vec4(13.1804495,0.7916005,5.338587,5.687114),vec4(-4.167605,-17.798311,-6.815736,-1.6451967))*buf[1]+mat4(vec4(0.604885,-7.800309,-7.213122,-2.741014),vec4(-3.522382,-0.12359311,-0.5258442,0.43852118),vec4(9.6752825,-22.853785,2.062431,0.099892326),vec4(-4.3196306,-17.730087,2.5184598,5.30267))*buf[2]+mat4(vec4(-6.545563,-15.790176,-6.0438633,-5.415399),vec4(-43.591583,28.551912,-16.00161,18.84728),vec4(4.212382,8.394307,3.0958717,8.657522),vec4(-5.0237565,-4.450633,-4.4768,-5.5010443))*buf[3]+mat4(vec4(1.6985557,-67.05806,6.897715,1.9004834),vec4(1.8680354,2.3915145,2.5231109,4.081538),vec4(11.158006,1.7294737,2.0738268,7.386411),vec4(-4.256034,-306.24686,8.258898,-17.132736))*buf[4]+mat4(vec4(1.6889864,-4.5852966,3.8534803,-6.3482175),vec4(1.3543309,-1.2640043,9.932754,2.9079645),vec4(-5.2770967,0.07150358,-0.13962056,3.3269649),vec4(28.34703,-4.918278,6.1044083,4.085355))*buf[5]+vec4(6.6818056,12.522166,-3.7075126,-4.104386);
  buf[7]=mat4(vec4(-8.265602,-4.7027016,5.098234,0.7509808),vec4(8.6507845,-17.15949,16.51939,-8.884479),vec4(-4.036479,-2.3946867,-2.6055532,-1.9866527),vec4(-2.2167742,-1.8135649,-5.9759874,4.8846445))*buf[0]+mat4(vec4(6.7790847,3.5076547,-2.8191125,-2.7028968),vec4(-5.743024,-0.27844876,1.4958696,-5.0517144),vec4(13.122226,15.735168,-2.9397483,-4.101023),vec4(-14.375265,-5.030483,-6.2599335,2.9848232))*buf[1]+mat4(vec4(4.0950394,-0.94011575,-5.674733,4.755022),vec4(4.3809423,4.8310084,1.7425908,-3.437416),vec4(2.117492,0.16342592,-104.56341,16.949184),vec4(-5.22543,-2.994248,3.8350096,-1.9364246))*buf[2]+mat4(vec4(-5.900337,1.7946124,-13.604192,-3.8060522),vec4(6.6583457,31.911177,25.164474,91.81147),vec4(11.840538,4.1503043,-0.7314397,6.768467),vec4(-6.3967767,4.034772,6.1714606,-0.32874924))*buf[3]+mat4(vec4(3.4992442,-196.91893,-8.923708,2.8142626),vec4(3.4806502,-3.1846354,5.1725626,5.1804223),vec4(-2.4009497,15.585794,1.2863957,2.0252278),vec4(-71.25271,-62.441242,-8.138444,0.50670296))*buf[4]+mat4(vec4(-12.291733,-11.176166,-7.3474145,4.390294),vec4(10.805477,5.6337385,-0.9385842,-4.7348723),vec4(-12.869276,-7.039391,5.3029537,7.5436664),vec4(1.4593618,8.91898,3.5101583,5.840625))*buf[5]+vec4(2.2415268,-6.705987,-0.98861027,-2.117676);
  buf[6]=sigmoid(buf[6]);buf[7]=sigmoid(buf[7]);
  buf[0]=mat4(vec4(1.6794263,1.3817469,2.9625452,0.),vec4(-1.8834411,-1.4806935,-3.5924516,0.),vec4(-1.3279216,-1.0918057,-2.3124623,0.),vec4(0.2662234,0.23235129,0.44178495,0.))*buf[0]+mat4(vec4(-0.6299101,-0.5945583,-0.9125601,0.),vec4(0.17828953,0.18300213,0.18182953,0.),vec4(-2.96544,-2.5819945,-4.9001055,0.),vec4(1.4195864,1.1868085,2.5176322,0.))*buf[1]+mat4(vec4(-1.2584374,-1.0552157,-2.1688404,0.),vec4(-0.7200217,-0.52666044,-1.438251,0.),vec4(0.15345335,0.15196142,0.272854,0.),vec4(0.945728,0.8861938,1.2766753,0.))*buf[2]+mat4(vec4(-2.4218085,-1.968602,-4.35166,0.),vec4(-22.683098,-18.0544,-41.954372,0.),vec4(0.63792,0.5470648,1.1078634,0.),vec4(-1.5489894,-1.3075932,-2.6444845,0.))*buf[3]+mat4(vec4(-0.49252132,-0.39877754,-0.91366625,0.),vec4(0.95609266,0.7923952,1.640221,0.),vec4(0.30616966,0.15693925,0.8639857,0.),vec4(1.1825981,0.94504964,2.176963,0.))*buf[4]+mat4(vec4(0.35446745,0.3293795,0.59547555,0.),vec4(-0.58784515,-0.48177817,-1.0614829,0.),vec4(2.5271258,1.9991658,4.6846647,0.),vec4(0.13042648,0.08864098,0.30187556,0.))*buf[5]+mat4(vec4(-1.7718065,-1.4033192,-3.3355875,0.),vec4(3.1664357,2.638297,5.378702,0.),vec4(-3.1724713,-2.6107926,-5.549295,0.),vec4(-2.851368,-2.249092,-5.3013067,0.))*buf[6]+mat4(vec4(1.5203838,1.2212278,2.8404984,0.),vec4(1.5210563,1.2651345,2.683903,0.),vec4(2.9789467,2.4364579,5.2347264,0.),vec4(2.2270417,1.8825914,3.8028636,0.))*buf[7]+vec4(-1.5468478,-3.6171484,0.24762098,0.);
  buf[0]=sigmoid(buf[0]);
  return vec4(buf[0].x,buf[0].y,buf[0].z,1.);
}`;

const DARK_VEIL_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uTime;
uniform float uPresence;
uniform float uEnergy;
out vec4 outColor;
${DARK_VEIL_CPPN}
void main() {
  vec2 screen = gl_FragCoord.xy / uResolution;
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;
  uv.y = -uv.y;
  float flow = 0.7 + uPresence * 0.5 + uEnergy * 0.4;
  float t = uTime;
  float turn = 0.06 * flow * sin(t * 0.17);
  uv = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * uv;
  uv += 0.05 * flow * vec2(sin(t * 0.21), cos(t * 0.13));
  uv = vec2(uResolution.x / uResolution.y, -1.0) + uv * 1.5;
  uv += (0.25 + uEnergy * 0.3) * vec2(sin(uv.y * 6.283 + t * 0.5), cos(uv.x * 6.283 + t * 0.5)) * 0.05;
  vec3 latent = 0.1 * flow * vec3(sin(0.3 * t), sin(0.69 * t), sin(0.44 * t));
  vec3 veil = cppn(uv, latent).rgb;
  float fold = dot(veil, vec3(0.3, 0.5, 0.2));
  float center = exp(-pow((screen.x - 0.5) / 0.28, 2.0));
  float alpha = (0.07 + pow(fold, 1.3) * 0.65) * (1.0 - center * 0.72);
  alpha *= 0.8 + uPresence * 0.15 + uEnergy * 0.05;
  vec3 color = mix(uContent, uAccent, 0.35 + veil.b * 0.35);
  outColor = vec4(color * alpha, alpha);
}`;

const AURORA_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uTime;
uniform float uPresence;
uniform float uEnergy;
out vec4 outColor;
#define TAU 6.28318

vec3 gradientHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 234.6)),
    dot(p, vec3(269.5, 183.3, 198.3)),
    dot(p, vec3(169.5, 283.3, 156.9))
  );
  vec3 h = fract(sin(p) * 43758.5453123);
  float phi = acos(2.0 * h.x - 1.0);
  float theta = TAU * h.y;
  return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
}

float quinticSmooth(float t) {
  float t2 = t * t;
  float t3 = t * t2;
  return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3;
}

vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

float perlin3D(float amplitude, float frequency, float px, float py, float pz) {
  float x = px * frequency;
  float y = py * frequency;

  float fx = floor(x);
  float fy = floor(y);
  float fz = floor(pz);
  float cx = ceil(x);
  float cy = ceil(y);
  float cz = ceil(pz);

  vec3 g000 = gradientHash(vec3(fx, fy, fz));
  vec3 g100 = gradientHash(vec3(cx, fy, fz));
  vec3 g010 = gradientHash(vec3(fx, cy, fz));
  vec3 g110 = gradientHash(vec3(cx, cy, fz));
  vec3 g001 = gradientHash(vec3(fx, fy, cz));
  vec3 g101 = gradientHash(vec3(cx, fy, cz));
  vec3 g011 = gradientHash(vec3(fx, cy, cz));
  vec3 g111 = gradientHash(vec3(cx, cy, cz));

  float d000 = dot(g000, vec3(x - fx, y - fy, pz - fz));
  float d100 = dot(g100, vec3(x - cx, y - fy, pz - fz));
  float d010 = dot(g010, vec3(x - fx, y - cy, pz - fz));
  float d110 = dot(g110, vec3(x - cx, y - cy, pz - fz));
  float d001 = dot(g001, vec3(x - fx, y - fy, pz - cz));
  float d101 = dot(g101, vec3(x - cx, y - fy, pz - cz));
  float d011 = dot(g011, vec3(x - fx, y - cy, pz - cz));
  float d111 = dot(g111, vec3(x - cx, y - cy, pz - cz));

  float sx = quinticSmooth(x - fx);
  float sy = quinticSmooth(y - fy);
  float sz = quinticSmooth(pz - fz);

  float lx00 = mix(d000, d100, sx);
  float lx10 = mix(d010, d110, sx);
  float lx01 = mix(d001, d101, sx);
  float lx11 = mix(d011, d111, sx);

  float ly0 = mix(lx00, lx10, sy);
  float ly1 = mix(lx01, lx11, sy);

  return amplitude * mix(ly0, ly1, sz);
}
float auroraGlow(float t, vec2 uv, float bend) {
  float noiseVal = 0.0;
  float freq = 2.5;
  float amp = 1.0 + uPresence * 0.2 + uEnergy * 0.4;
  vec2 samplePos = uv * 1.5;
  for (int i = 0; i < 3; i++) {
    noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp *= 0.1;
    freq *= 2.0;
  }
  float yBand = uv.y * 10.0 - (0.5 + bend) * 10.0;
  return 0.3 * exp(1.0 - 1.1 * abs(noiseVal + yBand));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 field = gl_FragCoord.xy / uResolution.y;
  float t = 0.4 * uTime;
  float bend = sin(field.x * 1.2 + t * 0.2) * (0.025 + uPresence * 0.02 + uEnergy * 0.03);
  float glow1 = auroraGlow(t, field, bend);
  float glow2 = auroraGlow(t + 0.9, field, -bend);
  vec3 gradient1 = cosineGradient(uv.x + t * 0.05, vec3(0.7), vec3(0.3), vec3(1.0), vec3(0.2));
  vec3 gradient2 = cosineGradient(uv.x + t * 0.03, vec3(0.7), vec3(0.3), vec3(1.0), vec3(0.4));
  vec3 col = 0.99 * glow1 * gradient1 * mix(uContent, uAccent, 0.25);
  col += 0.99 * glow2 * gradient2 * uAccent;
  float strength = glow1 + glow2;
  vec3 tint = col / max(strength, 0.0001);
  float center = exp(-pow((uv.x - 0.5) / 0.3, 2.0));
  float alpha = (1.0 - exp(-strength * 1.8)) * 0.62 * (1.0 - center * 0.72);
  outColor = vec4(tint * alpha, alpha);
}`;

const FLOATING_LINES_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uTime;
uniform float uPresence;
uniform float uEnergy;
out vec4 outColor;
vec2 warp(vec2 p, float rotate, float flip) {
  float angle = rotate * log(length(p) + 1.0);
  vec2 r = p * mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  if (flip > 0.5) r.x = -r.x;
  return r;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 screen = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  screen.y = -screen.y;
  float cover = 0.0;
  vec3 colorSum = vec3(0.0);
  for (int w = 0; w < 3; w++) {
    float family = float(w);
    float rotate = w == 0 ? -0.4 : w == 1 ? 0.2 : -1.0;
    float lift = w == 0 ? 0.5 : w == 1 ? 0.0 : -0.7;
    vec2 r = warp(screen, rotate, w == 0 ? 1.0 : 0.0);
    float sx = sin(r.x);
    float cx = cos(r.x);
    for (int i = 0; i < 6; i++) {
      float line = float(i);
      float offset = 1.0 + family * 0.5 + line * 0.2;
      float along = line * 0.16 + family * 3.0;
      float phase = along + offset + uTime * 0.1;
      float amp = sin(offset + uTime * 0.2) * 0.3 * (1.0 + uPresence * 0.35 + uEnergy * 0.55);
      float y = (sx * cos(phase) + cx * sin(phase)) * amp;
      float m = r.y + lift - y;
      float slope = length(vec2(dFdx(m), dFdy(m)));
      float d = abs(m) / max(slope, 1e-5);
      float width = 0.7 + uPresence * 0.2 + uEnergy * 0.3;
      float core = 1.0 - smoothstep(max(0.0, width - 0.75), width + 0.75, d);
      float halo = exp(-d / 3.0) * 0.16;
      float alpha = clamp((core * 0.65 + halo) * (w == 1 ? 1.0 : 0.65), 0.0, 0.9);
      vec3 tint = mix(uContent, uAccent, 0.2 + line / 6.0 * 0.6);
      colorSum = tint * alpha + colorSum * (1.0 - alpha);
      cover = alpha + cover * (1.0 - alpha);
    }
  }
  float center = exp(-pow((uv.x - 0.5) / 0.28, 2.0));
  float mask = 0.8 * (1.0 - center * 0.7);
  outColor = vec4(colorSum * mask, cover * mask);
}`;

const FRAGMENT_SHADERS: Record<ReactBitsSurfaceKind, string> = {
  threads: THREAD_FRAGMENT,
  silk: SILK_FRAGMENT,
  "dark-veil": DARK_VEIL_FRAGMENT,
  "soft-aurora": AURORA_FRAGMENT,
  "floating-lines": FLOATING_LINES_FRAGMENT,
};

/** CSS resolves palette tokens before this call. A single tiny CPU canvas also
 * accepts computed oklch()/color() values without a home-grown CSS color parser. */
function rgb(color: string, probe: CanvasRenderingContext2D): [number, number, number] {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const data = probe.getImageData(0, 0, 1, 1).data;
  return [data[0]! / 255, data[1]! / 255, data[2]! / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export function createReactBitsSurface(
  kind: ReactBitsSurfaceKind,
  canvas: HTMLCanvasElement,
  palette: LiveBackgroundPalette,
): ReactBitsSurface | null {
  let gl: WebGL2RenderingContext | null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const probe = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!probe) return null;
  const content = rgb(palette.content, probe);
  const accent = rgb(palette.accent, probe);
  probeCanvas.width = probeCanvas.height = 0;

  const vertex = compile(gl, gl.VERTEX_SHADER, kind === "threads" ? THREAD_VERTEX : SILK_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADERS[kind]);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPoint");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (!buffer || !vao) {
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    return null;
  }
  let vertices: Float32Array;
  if (kind === "threads") {
    vertices = new Float32Array((THREAD_SEGMENTS + 1) * 4);
    for (let i = 0; i <= THREAD_SEGMENTS; i++) {
      vertices.set([i / THREAD_SEGMENTS, -1, i / THREAD_SEGMENTS, 1], i * 4);
    }
  } else vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const uniforms = {
    resolution: gl.getUniformLocation(program, "uResolution"),
    time: gl.getUniformLocation(program, "uTime"),
    presence: gl.getUniformLocation(program, "uPresence"),
    energy: gl.getUniformLocation(program, "uEnergy"),
    content: gl.getUniformLocation(program, "uContent"),
    accent: gl.getUniformLocation(program, "uAccent"),
  };
  const vertexCount = vertices.length / 2;
  let disposed = false;
  let activityTime = 0;
  return {
    resize(width, height, ratio) {
      if (disposed) return;
      const w = Math.max(0, Number.isFinite(width) ? width : 0);
      const h = Math.max(0, Number.isFinite(height) ? height : 0);
      const dpr = Math.max(0.1, Math.min(MAX_DPR, Number.isFinite(ratio) ? ratio : 1));
      // The trained CPPN performs substantially more arithmetic per fragment.
      // Its soft veils tolerate a smaller backing store than fine line artwork.
      const widthCap = kind === "dark-veil" ? MAX_WIDTH / 2 : MAX_WIDTH;
      const heightCap = kind === "dark-veil" ? MAX_HEIGHT / 2 : MAX_HEIGHT;
      const scale = Math.min(dpr, widthCap / Math.max(1, w), heightCap / Math.max(1, h));
      const nextWidth = Math.max(1, Math.round(w * scale));
      const nextHeight = Math.max(1, Math.round(h * scale));
      if (canvas.width !== nextWidth) canvas.width = nextWidth;
      if (canvas.height !== nextHeight) canvas.height = nextHeight;
      gl.viewport(0, 0, nextWidth, nextHeight);
    },
    draw(time, delta, signal) {
      if (disposed || gl.isContextLost()) return;
      const presence = Math.max(0, Math.min(1, signal.presence));
      const energy = Math.max(0, Math.min(1, signal.energy ?? 0));
      activityTime += Math.max(0, Math.min(0.1, delta)) * (presence + energy * 0.8);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, time * (kind === "threads" ? 0.6 : 0.4) + activityTime * 0.7);
      gl.uniform1f(uniforms.presence, presence);
      gl.uniform1f(uniforms.energy, energy);
      gl.uniform3fv(uniforms.content, content);
      gl.uniform3fv(uniforms.accent, accent);
      if (kind === "threads")
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, vertexCount, THREAD_COUNT);
      else gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.bindVertexArray(null);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
