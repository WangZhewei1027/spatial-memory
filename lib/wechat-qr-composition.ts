async function loadImage(src: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  return image;
}

// The 430px WeChat code reserves roughly 180px for the center artwork.
const CENTER_DIAMETER_RATIO = 0.42;

export async function composeWeChatQr(url: string, centerImage: string): Promise<string> {
  const [code, logo] = await Promise.all([loadImage(url), loadImage(centerImage)]);
  const canvas = document.createElement("canvas");
  canvas.width = code.naturalWidth;
  canvas.height = code.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");

  context.drawImage(code, 0, 0);
  const x = canvas.width / 2;
  const y = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * CENTER_DIAMETER_RATIO / 2;
  context.beginPath();
  context.arc(x, y, radius, 0, 2 * Math.PI);
  context.clip();
  context.drawImage(logo, x - radius, y - radius, 2 * radius, 2 * radius);
  return canvas.toDataURL("image/png");
}
