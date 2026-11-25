"""Draws the app icon (build/icon.png, 512x512). Run: py -I build/make-icon.py"""
from PIL import Image, ImageDraw
import os

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# rounded purple tile with a soft vertical gradient
top, bottom = (124, 108, 255), (92, 72, 230)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    gd.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([16, 16, S - 16, S - 16], radius=110, fill=255)
img.paste(grad, (0, 0), mask)

# white planner sheet
d.rounded_rectangle([112, 120, 400, 404], radius=40, fill=(255, 255, 255, 245))
d.rounded_rectangle([112, 120, 400, 196], radius=40, fill=(230, 226, 255, 255))
d.rectangle([112, 160, 400, 196], fill=(230, 226, 255, 255))
for x in (180, 332):
    d.rounded_rectangle([x - 12, 92, x + 12, 148], radius=12, fill=(255, 255, 255, 255))

# checklist rows: two checked, one open
for i, y in enumerate((236, 292, 348)):
    box = [148, y - 16, 180, y + 16]
    if i < 2:
        d.rounded_rectangle(box, radius=8, fill=(107, 92, 255, 255))
        d.line([(155, y), (163, y + 8), (174, y - 8)], fill=(255, 255, 255, 255), width=6, joint="curve")
    else:
        d.rounded_rectangle(box, radius=8, outline=(160, 156, 190, 255), width=5)
    d.rounded_rectangle([200, y - 7, 360 - (i * 40), y + 7], radius=7, fill=(205, 202, 225, 255))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")
img.save(out)
img.save(out.replace(".png", ".ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
assets = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(assets, exist_ok=True)
img.resize((64, 64), Image.LANCZOS).save(os.path.join(assets, "tray.png"))
print("saved", out)
