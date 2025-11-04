import type { Canvas, Client, Shape } from "../types";

interface SerializedClient extends Omit<Client, "lastSeenVersion"> {
	lastSeenVersion: Record<string, number>;
}

interface SerializedCanvas extends Omit<Canvas, "clients"> {
	clients: SerializedClient[];
}

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

function generateClientColor(clientId: number): string {
	const colors = [
		"#ffbe0b",
		"#ff006e",
		"#3a86ff",
		"#8338ec",
		"#fb5607",
		"#06d6a0",
	];
	return colors[clientId % colors.length];
}

async function loadAndRenderShapes() {
	if (!canvas || !ctx) return;

	try {
		const response = await fetch("/api/db");
		const data: SerializedCanvas = await response.json();

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		data.clients.forEach((client: SerializedClient) => {
			const { x, y, width, height } = client.viewport;

			ctx.strokeStyle = "white";
			ctx.lineWidth = 2;
			ctx.strokeRect(x, y, width, height);

			ctx.fillStyle = "white";
			ctx.font = "16px Arial";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(client.id.toString(), x + 20, y + 20);
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

			const clientsWhoHaveSeen = data.clients.filter(
				(client: SerializedClient) => {
					const lastSeenVersion = client.lastSeenVersion[shape.id];
					return (
						lastSeenVersion !== undefined && lastSeenVersion >= shape.version
					);
				},
			);

			clientsWhoHaveSeen.forEach((client: SerializedClient, index: number) => {
				const clientColor = generateClientColor(client.id);
				ctx.strokeStyle = clientColor;
				ctx.lineWidth = 2;

				const offset = index * 2 + 4;

				if (shape.type === "circle" && shape.radius !== undefined) {
					ctx.beginPath();
					ctx.arc(shape.x, shape.y, shape.radius + offset, 0, Math.PI * 2);
					ctx.stroke();
				} else if (
					shape.type === "rectangle" &&
					shape.width !== undefined &&
					shape.height !== undefined
				) {
					ctx.strokeRect(
						shape.x - offset,
						shape.y - offset,
						shape.width + offset * 2,
						shape.height + offset * 2,
					);
				}
			});
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
