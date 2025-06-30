import { Request, Response, NextFunction } from 'express';
import { AVAILABLE_GATEWAYS, getActiveGateways } from '../types/gateway';
import prisma from '../config/database';

export class GatewayController {
  // GET /api/shop/gateways
  getAvailableGateways = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.user?.id;
      
      if (!shopId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Get shop's configured payment gateways from database
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: {
          paymentGateways: true,
        },
      });

      if (!shop) {
        return res.status(404).json({
          success: false,
          message: 'Shop not found',
        });
      }

      // Parse payment gateways from JSON string or return default
      let enabledGatewayNames: string[] = [];
      
      if (shop.paymentGateways) {
        try {
          enabledGatewayNames = JSON.parse(shop.paymentGateways);
        } catch (error) {
          console.error('Error parsing payment gateways:', error);
          // Fallback to default gateways if parsing fails
          enabledGatewayNames = ['Plisio'];
        }
      } else {
        // Default gateway if none configured
        enabledGatewayNames = ['Plisio'];
      }

      // Filter available gateways based on shop's enabled gateways
      const availableGateways = AVAILABLE_GATEWAYS.filter(gateway => 
        gateway.isActive && enabledGatewayNames.includes(gateway.displayName)
      );

      res.json({
        success: true,
        gateways: availableGateways.map(gateway => ({
          id: gateway.id,
          name: gateway.name,
          displayName: gateway.displayName,
          isActive: gateway.isActive,
        })),
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/gateways/all - Get all available gateways (public endpoint)
  getAllGateways = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        gateways: AVAILABLE_GATEWAYS.map(gateway => ({
          id: gateway.id,
          name: gateway.name,
          displayName: gateway.displayName,
          isActive: gateway.isActive,
        })),
      });
    } catch (error) {
      next(error);
    }
  };

  // GET /api/gateways/active - Get only active gateways (public endpoint)
  getActiveGateways = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const activeGateways = getActiveGateways();
      
      res.json({
        success: true,
        gateways: activeGateways.map(gateway => ({
          id: gateway.id,
          name: gateway.name,
          displayName: gateway.displayName,
          isActive: gateway.isActive,
        })),
      });
    } catch (error) {
      next(error);
    }
  };
}