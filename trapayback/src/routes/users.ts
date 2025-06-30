import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { validate, createUserSchema, updateUserSchema } from '../middleware/validation';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();
const userController = new UserController();

// All routes require admin authentication
router.use(authenticateToken, requireAdmin);

// User management routes
router.post('/', validate(createUserSchema), userController.createUser);
router.get('/', userController.getUsers);
router.get('/:id', userController.getUserById);
router.put('/:id', validate(updateUserSchema), userController.updateUser);
router.delete('/:id', userController.deleteUser);

export default router;