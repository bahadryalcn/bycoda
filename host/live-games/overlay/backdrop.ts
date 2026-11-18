type Context = CanvasRenderingContext2D;

function diamond(context: Context, x: number, y: number, size: number): void {
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x + size, y);
  context.lineTo(x, y + size);
  context.lineTo(x - size, y);
  context.closePath();
}

function lantern(context: Context, x: number, y: number, size: number): void {
  const aura = context.createRadialGradient(x, y, 0, x, y, size * 2.5);
  aura.addColorStop(0, "#e59345a3");
  aura.addColorStop(1, "#e5934500");
  context.fillStyle = aura;
  context.fillRect(x - size * 2.5, y - size * 2.5, size * 5, size * 5);
  context.strokeStyle = "#c38a51";
  context.lineWidth = size * 0.045;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, y - size * 0.56);
  context.stroke();
  context.fillStyle = "#ffd187";
  context.beginPath();
  context.ellipse(x, y, size * 0.37, size * 0.5, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(x - size * 0.24, y - size * 0.51);
  context.lineTo(x + size * 0.24, y - size * 0.51);
  context.moveTo(x - size * 0.24, y + size * 0.51);
  context.lineTo(x + size * 0.24, y + size * 0.51);
  context.moveTo(x, y + size * 0.51);
  context.lineTo(x, y + size * 0.78);
  context.stroke();
}

/** Paint the fixed set once so dense rings only animate dancers and effects. */
export function drawBackdrop(context: Context, width: number, height: number): void {
  const wide = width > height;
  const floorX = width * (wide ? 0.56 : 0.5);
  const floorY = height * (wide ? 0.58 : 0.53);
  const backdrop = context.createLinearGradient(0, 0, width * 0.38, height);
  backdrop.addColorStop(0, "#071d1e");
  backdrop.addColorStop(0.58, "#153c34");
  backdrop.addColorStop(1, "#061f1e");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  const light = context.createRadialGradient(floorX, floorY, 0, floorX, floorY, width * 0.59);
  light.addColorStop(0, "#d8a45d45");
  light.addColorStop(1, "#d8a45d00");
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(floorX, floorY);
  context.scale(width * (wide ? 0.39 : 0.43), height * (wide ? 0.31 : 0.234));
  const rug = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  rug.addColorStop(0, "#59543a");
  rug.addColorStop(0.7, "#414a33");
  rug.addColorStop(1, "#282f25");
  context.fillStyle = rug;
  context.strokeStyle = "#d0a66485";
  context.lineWidth = 0.009;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  for (const radius of [0.95, 0.85, 0.58, 0.43]) {
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
  }
  for (let index = 0; index < 64; index++) {
    const angle = (index * Math.PI) / 32;
    const x = Math.cos(angle) * 0.9;
    const y = Math.sin(angle) * 0.9;
    diamond(context, x, y, 0.023);
    context.fillStyle = index % 2 === 0 ? "#d1a2667a" : "#bd695579";
    context.fill();
  }
  context.strokeStyle = "#ddbe8272";
  for (const offset of [-0.13, 0, 0.13]) {
    diamond(context, offset, 0, 0.18);
    context.stroke();
  }
  context.restore();

  const inset = Math.min(width, height) * 0.025;
  context.strokeStyle = "#b7965d73";
  context.lineWidth = 1;
  context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  context.strokeRect(inset + 8, inset + 8, width - (inset + 8) * 2, height - (inset + 8) * 2);
  for (const x of [width * 0.12, width * 0.88]) {
    lantern(context, x, height * 0.136, Math.min(width, height) * 0.036);
  }
  for (const x of [width * 0.2, width * 0.8]) {
    lantern(context, x, height * 0.097, Math.min(width, height) * 0.024);
  }
}
