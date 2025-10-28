import type { Canvas } from "./types";

const db: Canvas = {
	shapes: [
		{
			id: "1",
			type: "circle",
			x: 50,
			y: 50,
			radius: 20,
			color: "red",
			strokeWidth: 2,
		},
		{
			id: "2",
			type: "rectangle",
			x: 100,
			y: 100,
			width: 40,
			height: 30,
			color: "blue",
		},
		{
			id: "3",
			type: "circle",
			x: 200,
			y: 150,
			radius: 15,
			color: "green",
			strokeWidth: 1,
		},
		{
			id: "4",
			type: "rectangle",
			x: 250,
			y: 200,
			width: 60,
			height: 40,
			color: "yellow",
			strokeWidth: 3,
		},
	],
	clients: [],
};

export default db;
