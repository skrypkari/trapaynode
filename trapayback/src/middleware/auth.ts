import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { JWTPayload } from '../types/auth';
import { tokenBlacklistService } from '../services/tokenBlacklistService';

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      token?: string;
    }
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  // Check if token is blacklisted
  if (tokenBlacklistService.isTokenBlacklisted(token)) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token has been revoked' 
    });
  }

  jwt.verify(token, config.jwt.secret, (err, decoded) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }

    req.user = decoded as JWTPayload;
    req.token = token; // Store token for potential blacklisting
    next();
  });
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }
  next();
};

export const requireShop = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'shop') {
    return res.status(403).json({ 
      success: false, 
      message: 'Shop access required' 
    });
  }
  next();
};