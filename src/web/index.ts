import type { Canvas, Client, Shape } from "../types";

const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Canvas element not found");

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context not supported");

function setupCanvas() {
	if (!canvas || !ctx) return;

	const dpr = window.devicePixelRatio || 1;
	const displayWidth = 1200;
	const displayHeight = 800;

	canvas.width = displayWidth * dpr;
	canvas.height = displayHeight * dpr;

	canvas.style.width = `${displayWidth}px`;
	canvas.style.height = `${displayHeight}px`;

	ctx.scale(dpr, dpr);
}

setupCanvas();

async function loadAndRenderShapes() {
	if (!canvas || !ctx) return;

	try {
		const response = await fetch("/api/db");
		const data: Canvas = await response.json();

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		data.clients.forEach((client: Client) => {
			const { x, y, width, height } = client.location;

			ctx.strokeStyle = "white";
			ctx.lineWidth = 2;
			ctx.strokeRect(x, y, width, height);

			ctx.fillStyle = "white";
			ctx.font = "16px Arial";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(client.id.toString(), x + width / 2, y + height / 2);
		});

		data.shapes.forEach((shape: Shape) => {
			ctx.fillStyle = shape.color;

			if (shape.strokeWidth) {
				ctx.lineWidth = shape.strokeWidth;
				ctx.strokeStyle = "white";
			}

			if (shape.type === "circle" && shape.radius !== undefined) {
				ctx.beginPath();
				ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
				ctx.fill();
				if (shape.strokeWidth) ctx.stroke();
			} else if (
				shape.type === "rectangle" &&
				shape.width !== undefined &&
				shape.height !== undefined
			) {
				ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
				if (shape.strokeWidth) {
					ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
				}
			}
		});
	} catch (error) {
		console.error("Failed to load shapes:", error);
	}
}

loadAndRenderShapes();

let ws: WebSocket;

function connectWebSocket() {
	ws = new WebSocket("ws://localhost:3000/ws?client=web");

	ws.onopen = () => {
		console.log("WebSocket connected");
	};

	ws.onmessage = (event) => {
		console.log(event);
		if (event.data === "reload") {
			console.log("reloading");
			loadAndRenderShapes();
		} else if (event.data === "reload-page") {
			window.location.reload();
		}
	};

	ws.onclose = () => {
		console.log("WebSocket disconnected, reconnecting in 100 ms...");
		setTimeout(connectWebSocket, 100);
	};

	ws.onerror = (error) => {
		console.error("WebSocket error:", error);
	};
}

connectWebSocket();

window.addEventListener("focus", loadAndRenderShapes);
