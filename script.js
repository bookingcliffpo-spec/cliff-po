const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let x = 300;
let y = 300;

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") y -= 10;
  if (e.key === "ArrowDown") y += 10;
  if (e.key === "ArrowLeft") x -= 10;
  if (e.key === "ArrowRight") x += 10;
});

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "gold";
  ctx.fillRect(x, y, 50, 50);

  requestAnimationFrame(gameLoop);
}

gameLoop();