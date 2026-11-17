import { Receiver } from '../Receiver.js';

export interface AsyncTemplate<Context> {
  render (context: Context, receiver: Receiver): Promise<string>;
}
