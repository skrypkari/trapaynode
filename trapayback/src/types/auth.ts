export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  role: 'admin' | 'shop';
  user?: {
    id: string;
    name: string;
    username: string;
  };
}

export interface JWTPayload {
  id: string;
  username: string;
  role: 'admin' | 'shop';
  iat?: number;
  exp?: number;
}