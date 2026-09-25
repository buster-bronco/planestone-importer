// loose foundry globals; the community typings lag behind v13
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const game: any;
declare const ui: any;
declare const Hooks: any;
declare const CONFIG: any;
declare const foundry: any;
declare const Actor: any;
declare function fromUuid(uuid: string): Promise<any>;

declare module "*.scss";
