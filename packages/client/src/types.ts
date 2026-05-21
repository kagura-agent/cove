export interface Channel {
  id: string;
  name: string;
  topic?: string;
  icon?: string;
  type?: number;
}

export interface Author {
  id: string;
  username: string;
  avatar?: string | null;
}

export interface Message {
  id: string;
  channel_id: string;
  content: string;
  author: Author;
  timestamp: string;
}

export interface Bot {
  id: string;
  username: string;
  emoji?: string;
  bio?: string;
  bot: boolean;
}

export interface BotCreateResponse {
  id: string;
  username: string;
  token: string;
  emoji?: string;
  bio?: string;
}
