/**
 * Project Root Middleware
 * Extracts and validates X-Project-Root header for MCP endpoints
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

const path = require('path');
const fs = require('fs');

/**
 * Middleware to extract and validate X-Project-Root header
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function projectRootMiddleware(req, res, next) {
  const startTime = Date.now();
  
  try {
    // Requirement 2.1: Read X-Project-Root header
    const encodedProjectRoot = req.headers['x-project-root'];
    
    // Requirement 2.2: Return 400 if header is missing
    if (!encodedProjectRoot) {
      console.error('[MCP] Missing X-Project-Root header');
      return res.status(400).json({
        success: false,
        error: 'X-Project-Root header is required'
      });
    }
    
    // Requirement 2.3: Decode using decodeURIComponent
    let projectRoot;
    try {
      projectRoot = decodeURIComponent(encodedProjectRoot);
    } catch (decodeError) {
      console.error('[MCP] Failed to decode X-Project-Root header:', decodeError.message);
      return res.status(400).json({
        success: false,
        error: 'Invalid X-Project-Root header encoding'
      });
    }
    
    // Requirement 2.4: Validate that path is absolute
    if (!path.isAbsolute(projectRoot)) {
      console.error('[MCP] X-Project-Root is not an absolute path:', projectRoot);
      return res.status(400).json({
        success: false,
        error: 'X-Project-Root must be an absolute path'
      });
    }
    
    // Requirement 2.5: Validate that path exists on filesystem
    try {
      const stats = fs.statSync(projectRoot);
      if (!stats.isDirectory()) {
        console.error('[MCP] X-Project-Root is not a directory:', projectRoot);
        return res.status(400).json({
          success: false,
          error: 'X-Project-Root must be a directory'
        });
      }
    } catch (fsError) {
      console.error('[MCP] X-Project-Root does not exist:', projectRoot, fsError.message);
      return res.status(400).json({
        success: false,
        error: 'X-Project-Root path does not exist or is not accessible'
      });
    }
    
    // Requirement 2.6: Attach validated path to req.projectRoot
    req.projectRoot = projectRoot;
    
    const duration = Date.now() - startTime;
    console.log(`[MCP] Project root validated: ${projectRoot} | ${duration}ms`);
    
    next();
  } catch (error) {
    console.error('[MCP] Unexpected error in projectRootMiddleware:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while validating project root'
    });
  }
}

module.exports = projectRootMiddleware;
