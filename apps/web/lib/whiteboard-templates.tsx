/**
 * Whiteboard starter templates. Each builds a small set of canvas elements
 * that seed a new board, so people don't start from a blank page. Kept
 * deliberately light — a few shapes and sticky notes, no heavy previews — so
 * the picker stays compact on the hub.
 */
import type { ReactNode } from "react";
import type { WhiteboardElement } from "@/lib/api";
import { Icons } from "@/components/icons";

export interface WhiteboardTemplate {
  id: string;
  name: string;
  desc: string;
  icon: ReactNode;
  /** Soft background tint for the picker thumbnail. */
  tint: string;
  /** Produce a fresh set of elements (unique ids each call). */
  build: () => WhiteboardElement[];
}

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `e${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const C = {
  yellow: "#FFE066",
  blue: "#74C0FC",
  green: "#8CE99A",
  pink: "#FFA8C5",
  purple: "#D0BFFF",
  orange: "#FFC078",
  panel: "#F1F3F5",
};

const sticky = (x: number, y: number, text: string, color: string): WhiteboardElement => ({
  id: uid(), kind: "sticky", x, y, w: 170, h: 130, text, color,
});
const rect = (x: number, y: number, w: number, h: number, text: string, color: string): WhiteboardElement => ({
  id: uid(), kind: "rect", x, y, w, h, text, color,
});
const ellipse = (x: number, y: number, w: number, h: number, text: string, color: string): WhiteboardElement => ({
  id: uid(), kind: "ellipse", x, y, w, h, text, color,
});
const label = (x: number, y: number, text: string): WhiteboardElement => ({
  id: uid(), kind: "text", x, y, w: 220, h: 34, text, fontSize: 20,
});

export const WHITEBOARD_TEMPLATES: WhiteboardTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    desc: "A clean canvas.",
    icon: Icons.plus,
    tint: "#EDE9FE",
    build: () => [],
  },
  {
    id: "kanban",
    name: "Kanban",
    desc: "To do / In progress / Done columns.",
    icon: Icons.dashboards,
    tint: "#E7F5FF",
    build: () => [
      rect(40, 60, 230, 440, "", C.panel),
      rect(300, 60, 230, 440, "", C.panel),
      rect(560, 60, 230, 440, "", C.panel),
      label(56, 24, "To do"),
      label(316, 24, "In progress"),
      label(576, 24, "Done"),
      sticky(70, 90, "First task", C.yellow),
      sticky(70, 240, "Another task", C.yellow),
      sticky(330, 90, "Being worked on", C.blue),
      sticky(590, 90, "Shipped", C.green),
    ],
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    desc: "A central idea with notes around it.",
    icon: Icons.sparkles,
    tint: "#F3F0FF",
    build: () => [
      ellipse(320, 220, 200, 120, "Central idea", C.purple),
      sticky(90, 70, "Idea", C.yellow),
      sticky(560, 70, "Idea", C.blue),
      sticky(90, 380, "Idea", C.green),
      sticky(560, 380, "Idea", C.pink),
      sticky(340, 40, "Idea", C.orange),
      sticky(340, 430, "Idea", C.blue),
    ],
  },
  {
    id: "retro",
    name: "Retro",
    desc: "Start / Stop / Continue retrospective.",
    icon: Icons.clock,
    tint: "#E6FCF5",
    build: () => [
      rect(40, 60, 230, 440, "", C.panel),
      rect(300, 60, 230, 440, "", C.panel),
      rect(560, 60, 230, 440, "", C.panel),
      label(56, 24, "Start"),
      label(316, 24, "Stop"),
      label(576, 24, "Continue"),
      sticky(70, 90, "Start doing…", C.green),
      sticky(330, 90, "Stop doing…", C.pink),
      sticky(590, 90, "Keep doing…", C.blue),
    ],
  },
  {
    id: "swot",
    name: "SWOT",
    desc: "Strengths / Weaknesses / Opportunities / Threats.",
    icon: Icons.flag,
    tint: "#FFF4E6",
    build: () => [
      rect(40, 50, 370, 260, "", C.green),
      rect(430, 50, 370, 260, "", C.pink),
      rect(40, 330, 370, 260, "", C.blue),
      rect(430, 330, 370, 260, "", C.orange),
      label(56, 60, "Strengths"),
      label(446, 60, "Weaknesses"),
      label(56, 340, "Opportunities"),
      label(446, 340, "Threats"),
    ],
  },
  {
    id: "flow",
    name: "Flow",
    desc: "A simple top-to-bottom process.",
    icon: Icons.branch,
    tint: "#FFF0F6",
    build: () => [
      ellipse(320, 30, 180, 80, "Start", C.green),
      rect(320, 150, 180, 90, "Step 1", C.blue),
      rect(320, 280, 180, 90, "Decision?", C.yellow),
      ellipse(320, 410, 180, 80, "Done", C.purple),
    ],
  },
];
