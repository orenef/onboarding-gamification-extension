import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sqlite3, * as sqlite3_types from "sqlite3"; 

const sqlite = sqlite3.verbose();
const DB_PATH = "onboarding_data.db";

interface UserDataRow {
    key: string;
    value: number;
}

interface CompletedTaskRow {
    task_id: string;
}

const TASK_POINTS: { [key: string]: number } = {
  "task-001": 50,
  "task-002": 100,
  "task-003": 25,
};
const ALL_TASKS = Object.keys(TASK_POINTS);

class DbManager {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite.Database(DB_PATH, (err) => {
      if (err) {
        console.error("Could not connect to database:", err.message);
      } else {
        console.log("Connected to the SQLite database.");
      }
    });
  }

  public async initDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(
          `CREATE TABLE IF NOT EXISTS completed_tasks (
            task_id TEXT PRIMARY KEY
          )`,
          (err) => {
            if (err) return reject(err);
          }
        );

        this.db.run(
          `CREATE TABLE IF NOT EXISTS user_data (
            key TEXT PRIMARY KEY,
            value INTEGER
          )`,
          (err) => {
            if (err) return reject(err);
            this.db.run(`INSERT OR IGNORE INTO user_data (key, value) VALUES ('total_points', 0)`, (err) => {
                 if (err) return reject(err);
                 resolve();
            });
          }
        );
      });
    });
  }

  public async getPoints(): Promise<number> {
    return new Promise((resolve) => {
      this.db.get("SELECT value FROM user_data WHERE key = 'total_points'", (err, row: UserDataRow | undefined) => {
        if (err || !row) {
          resolve(0);
        } else {
          resolve(row.value); 
        }
      });
    });
  }

  public async updatePoints(newPoints: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_data SET value = ? WHERE key = 'total_points'`,
        [newPoints],
        function (err) {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  public async getCompletedTasks(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT task_id FROM completed_tasks", (err, rows: CompletedTaskRow[]) => {
        if (err) return reject(err);
        resolve(rows.map((row) => row.task_id)); 
      });
    });
  }

  public async markTaskCompleted(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO completed_tasks (task_id) VALUES (?)`,
        [taskId],
        function (err) {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }
}

const server = new McpServer({
  name: "onboarding-gamification-server",
  version: "1.0.0",
});

const dbManager = new DbManager();

function getNextTask(completedTasks: string[]): string | null {
  for (const task of ALL_TASKS) {
    if (!completedTasks.includes(task)) {
      return task;
    }
  }
  return null;
}

// Tool 1: get_user_status

server.registerTool(
  "get_user_status",
  {
    title: "Check Onboarding Status",
    description: "Retrieves the user's current total points and the next suggested onboarding task.",
    inputSchema: z.object({}).shape, 
  },
  async () => {
    const userPoints = await dbManager.getPoints();
    const completedTasks = await dbManager.getCompletedTasks();
    const nextTask = getNextTask(completedTasks);

    const nextTaskText = nextTask ? `Next Task: **${nextTask}**` : "Congratulations! All onboarding tasks are complete!";

    const resultText = `Current Status:
      - Points: ${userPoints}
      - Completed Tasks: ${completedTasks.join(", ") || "None"}
      - ${nextTaskText}`;

    return {
      content: [
        {
          type: "text",
          text: resultText,
        },
      ],
      data: {
        points: userPoints,
        completed_tasks: completedTasks,
        next_task_id: nextTask,
      },
    };
  }
);

// Tool 2: complete_task

server.registerTool(
  "complete_task",
  {
    title: "Complete Onboarding Task",
    description: "Marks a specific onboarding task as completed and awards points. MUST be used when the user confirms task completion.",
    inputSchema: z.object({
      task_id: z
        .string()
        .describe("The unique ID of the completed task (e.g., 'task-002')"),
    }).shape, 
  },
  async ({ task_id }) => {
    const completedTasks = await dbManager.getCompletedTasks();

    if (!TASK_POINTS.hasOwnProperty(task_id)) {
      return {
        content: [
          { type: "text", text: `Error: Task ID '${task_id}' is unknown.` },
        ],
      };
    }
    if (completedTasks.includes(task_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Info: Task '${task_id}' was already completed. No points awarded.`,
          },
        ],
      };
    }

    const points = TASK_POINTS[task_id];
    const currentPoints = await dbManager.getPoints();
    const newPoints = currentPoints + points;

    await dbManager.markTaskCompleted(task_id);
    await dbManager.updatePoints(newPoints);

const updatedCompletedTasks = await dbManager.getCompletedTasks();
    const nextTask = getNextTask(updatedCompletedTasks);
    
    const nextTaskText = nextTask ? `Next step: **${nextTask}**` : "All tasks completed! Amazing work!";

    const resultText = `Task **${task_id}** completed! You earned **${points} points**!
      Your new total is **${newPoints} points**.
      ${nextTaskText}`;
      
    // --- New: Define the ASCII Art ---
    const celebrationArt = `
      __
    __(o )
    ===  |
      | \___/|
      \ \=== |
        \_\==/
          ||
          ||
       ===  LEVEL UP!
    `;

  return {
      content: [
        { type: "text", text: celebrationArt }, // ASCII art goes first
        { type: "text", text: resultText }
      ],
      data: {
        new_points: newPoints,
        task_completed: task_id,
        points_awarded: points,
        next_task_id: nextTask,
      },
    };
  }
);

async function main() {
  await dbManager.initDb();
  console.log("Starting MCP Gamification Server...");
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("MCP Gamification Server connected via stdio.");
}

main();