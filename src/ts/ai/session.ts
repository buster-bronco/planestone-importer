import type { ChatMessage } from "./client";

export type ChatSend = (system: string, messages: ChatMessage[]) => Promise<string>;
// reply → validation errors; empty when the reply is usable
export type Validate = (reply: string) => Promise<string[]>;

export function repairText(errors: string[]): string {
  return `That YAML didn't validate:\n${errors.map((error) => `- ${error}`).join("\n")}\n\nReply with the corrected, complete yaml block.`;
}

export function correctionText(text: string, rejected: string[]): string {
  const parts: string[] = [];
  if (rejected.length) parts.push(`I rejected these parts of your last patch; leave them out:\n${rejected.map((line) => `- ${line}`).join("\n")}`);
  parts.push(text.trim() || "Send the patch again without them.");
  return parts.join("\n\n");
}

// one ai conversation; failed yaml gets one automatic repair turn
export class AiSession {
  readonly messages: ChatMessage[] = [];

  constructor(
    private system: string,
    private send: ChatSend,
    private validate: Validate,
    private repairs = 1,
  ) {}

  async ask(text: string): Promise<string> {
    return this.turn(() => this.messages.push({ role: "user", content: text }));
  }

  // drops the last reply and its repair turns, then asks again
  async redo(): Promise<string> {
    return this.turn(() => {
      while (this.messages.length && (this.messages.at(-1)!.role === "assistant" || this.messages.at(-1)!.auto)) this.messages.pop();
    });
  }

  async correct(text: string, rejected: string[]): Promise<string> {
    return this.ask(correctionText(text, rejected));
  }

  // a failed call leaves the thread as it was
  private async turn(prepare: () => void): Promise<string> {
    const before = [...this.messages];
    try {
      prepare();
      let reply = await this.complete();
      for (let i = 0; i < this.repairs; i++) {
        const errors = await this.validate(reply);
        if (!errors.length) break;
        this.messages.push({ role: "user", content: repairText(errors), auto: true });
        reply = await this.complete();
      }
      return reply;
    } catch (err) {
      this.messages.splice(0, this.messages.length, ...before);
      throw err;
    }
  }

  private async complete(): Promise<string> {
    const reply = await this.send(this.system, this.messages);
    this.messages.push({ role: "assistant", content: reply });
    return reply;
  }
}
