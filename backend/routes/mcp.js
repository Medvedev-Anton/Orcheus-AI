/**
 * MCP (Model Context Protocol) Router
 * Provides file system operations for Flowise AI agents
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 14.4
 */

const express = require('express');
const router = express.Router();

// Import existing middleware
const authMiddleware = require('../middleware/auth');
const rateLimitMiddleware = require('../middleware/rateLimit');
const projectRootMiddleware = require('../middleware/projectRoot');

// Import file helpers
const { safeResolve, listDir, searchInFiles, withTimeout } = require('../utils/fileHelpers');

// Middleware stack: auth → rate limit → project root
// Requirement 4.1, 4.2: Authentication required
router.use(authMiddleware);

// Requirement 14.4: Rate limiting (60 requests/minute)
router.use(rateLimitMiddleware);

// Requirement 2.1-2.6: Project root validation
router.use(projectRootMiddleware);

/**
 * POST /mcp/list_files
 * List directory contents
 * Requirements: 1.1, 1.6, 1.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 14.3
 */
router.post('/list_files', async (req, res) => {
  const startTime = Date.now();
  const userId = req.userId || 'unknown';
  
  try {
    // Requirement 1.6: Accept JSON body with "parameters" object
    const { parameters } = req.body;
    
    if (!parameters || typeof parameters !== 'object') {
      console.error(`[MCP] list_files | user=${userId} | ERROR: Missing parameters object`);
      return res.status(400).json({
        success: false,
        error: 'Request body must contain "parameters" object'
      });
    }
    
    // Requirement 5.1: Extract parameters.path (default to ".")
    const relPath = parameters.path || '.';
    
    // Requirement 5.2, 5.3: Extract parameters.recursive (default to false)
    const recursive = parameters.recursive === true;
    
    // Requirement 3.1: Use safeResolve to validate path
    let fullPath;
    try {
      fullPath = safeResolve(req.projectRoot, relPath);
    } catch (pathError) {
      console.error(`[MCP] list_files | user=${userId} | path=${relPath} | ERROR: ${pathError.message}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or unsafe path'
      });
    }
    
    // Requirement 5.1: List directory contents
    let files;
    try {
      if (recursive) {
        // Requirement 5.2: Recursively list subdirectories
        // Requirement 14.3: Limit recursive depth to 10 levels
        // Requirement 14.5, 14.6: Wrap with 30s timeout
        files = await withTimeout(
          listDir(fullPath, relPath === '.' ? '' : relPath, 0, 10),
          30000,
          'List directory'
        );
      } else {
        // Requirement 5.3: List only immediate children
        files = await withTimeout(
          listDir(fullPath, relPath === '.' ? '' : relPath, 0, 1),
          30000,
          'List directory'
        );
        // Remove children property for non-recursive listing
        files = files.map(f => {
          const { children, ...rest } = f;
          return rest;
        });
      }
    } catch (fsError) {
      // Requirement 5.8: Return error if directory not readable
      // Check if timeout error
      if (fsError.message && fsError.message.includes('timed out')) {
        console.error(`[MCP] list_files | user=${userId} | path=${relPath} | ERROR: ${fsError.message}`);
        return res.status(408).json({
          success: false,
          error: 'Operation timed out (maximum 30 seconds)'
        });
      }
      
      console.error(`[MCP] list_files | user=${userId} | path=${relPath} | ERROR: ${fsError.message}`);
      return res.status(400).json({
        success: false,
        error: 'Directory does not exist or is not readable'
      });
    }
    
    const duration = Date.now() - startTime;
    
    // Requirement 4.5, 15.1, 15.2, 15.3: Audit logging
    console.log(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/list_files | root=${req.projectRoot} | path=${relPath} | recursive=${recursive} | files=${files.length} | result=success | duration=${duration}ms`);
    
    // Requirement 1.7: Return JSON response with success and data
    return res.status(200).json({
      success: true,
      data: {
        files
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/list_files | ERROR: ${error.message} | duration=${duration}ms`);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error while listing files'
    });
  }
});

// Requirement 1.2: POST /mcp/read_file
router.post('/read_file', async (req, res) => {
  const startTime = Date.now();
  const userId = req.userId || 'unknown';
  
  try {
    // Requirement 1.6: Accept JSON body with "parameters" object
    const { parameters } = req.body;
    
    if (!parameters || typeof parameters !== 'object') {
      console.error(`[MCP] read_file | user=${userId} | ERROR: Missing parameters object`);
      return res.status(400).json({
        success: false,
        error: 'Request body must contain "parameters" object'
      });
    }
    
    // Requirement 6.1: Extract parameters.path
    const relPath = parameters.path;
    
    if (!relPath || typeof relPath !== 'string') {
      console.error(`[MCP] read_file | user=${userId} | ERROR: Missing or invalid path parameter`);
      return res.status(400).json({
        success: false,
        error: 'Parameter "path" is required and must be a string'
      });
    }
    
    // Requirement 6.2, 3.1: Use safeResolve to validate and resolve path
    let fullPath;
    try {
      fullPath = safeResolve(req.projectRoot, relPath);
    } catch (pathError) {
      console.error(`[MCP] read_file | user=${userId} | path=${relPath} | ERROR: ${pathError.message}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or unsafe path'
      });
    }
    
    // Requirement 6.6, 14.1: Check file size before reading (max 10MB)
    const fs = require('fs');
    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch (statError) {
      // Requirement 6.4: Return 404 if file not found
      console.error(`[MCP] read_file | user=${userId} | path=${relPath} | ERROR: File not found`);
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    if (!stats.isFile()) {
      console.error(`[MCP] read_file | user=${userId} | path=${relPath} | ERROR: Path is not a file`);
      return res.status(400).json({
        success: false,
        error: 'Path must point to a file, not a directory'
      });
    }
    
    // Requirement 6.7, 14.1: Return 400 if file exceeds 10MB limit
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
    if (stats.size > MAX_FILE_SIZE) {
      console.error(`[MCP] read_file | user=${userId} | path=${relPath} | size=${stats.size} | ERROR: File too large`);
      return res.status(400).json({
        success: false,
        error: 'File too large (maximum 10MB)'
      });
    }
    
    // Requirement 6.1: Read file content as UTF-8
    let content;
    try {
      // Requirement 14.5, 14.6: Wrap with 30s timeout
      content = await withTimeout(
        fs.promises.readFile(fullPath, 'utf8'),
        30000,
        'Read file'
      );
    } catch (readError) {
      // Check if timeout error
      if (readError.message && readError.message.includes('timed out')) {
        console.error(`[MCP] read_file | user=${userId} | path=${relPath} | ERROR: ${readError.message}`);
        return res.status(408).json({
          success: false,
          error: 'Operation timed out (maximum 30 seconds)'
        });
      }
      
      // Requirement 6.5: Return error if file not readable
      console.error(`[MCP] read_file | user=${userId} | path=${relPath} | ERROR: ${readError.message}`);
      return res.status(400).json({
        success: false,
        error: 'File is not readable'
      });
    }
    
    const duration = Date.now() - startTime;
    
    // Requirement 4.5, 15.1, 15.2, 15.3: Audit logging
    console.log(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/read_file | root=${req.projectRoot} | file=${relPath} | size=${stats.size} | result=success | duration=${duration}ms`);
    
    // Requirement 1.7, 6.3: Return JSON response with success and data
    return res.status(200).json({
      success: true,
      data: {
        content,
        path: relPath
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/read_file | ERROR: ${error.message} | duration=${duration}ms`);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error while reading file'
    });
  }
});

// Requirement 1.3: POST /mcp/write_file
router.post('/write_file', async (req, res) => {
  const startTime = Date.now();
  const userId = req.userId || 'unknown';
  
  try {
    // Requirement 1.6: Accept JSON body with "parameters" object
    const { parameters } = req.body;
    
    if (!parameters || typeof parameters !== 'object') {
      console.error(`[MCP] write_file | user=${userId} | ERROR: Missing parameters object`);
      return res.status(400).json({
        success: false,
        error: 'Request body must contain "parameters" object'
      });
    }
    
    // Requirement 7.1: Extract parameters.path and parameters.content
    const relPath = parameters.path;
    const content = parameters.content;
    
    if (!relPath || typeof relPath !== 'string') {
      console.error(`[MCP] write_file | user=${userId} | ERROR: Missing or invalid path parameter`);
      return res.status(400).json({
        success: false,
        error: 'Parameter "path" is required and must be a string'
      });
    }
    
    if (typeof content !== 'string') {
      console.error(`[MCP] write_file | user=${userId} | path=${relPath} | ERROR: Missing or invalid content parameter`);
      return res.status(400).json({
        success: false,
        error: 'Parameter "content" is required and must be a string'
      });
    }
    
    // Requirement 7.2, 3.1: Use safeResolve to validate and resolve path
    let fullPath;
    try {
      fullPath = safeResolve(req.projectRoot, relPath);
    } catch (pathError) {
      console.error(`[MCP] write_file | user=${userId} | path=${relPath} | ERROR: ${pathError.message}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or unsafe path'
      });
    }
    
    const fs = require('fs');
    const path = require('path');
    
    // Requirement 7.3: Create parent directories if they don't exist
    const parentDir = path.dirname(fullPath);
    try {
      // Requirement 14.5, 14.6: Wrap with 30s timeout
      await withTimeout(
        fs.promises.mkdir(parentDir, { recursive: true }),
        30000,
        'Create directory'
      );
    } catch (mkdirError) {
      // Check if timeout error
      if (mkdirError.message && mkdirError.message.includes('timed out')) {
        console.error(`[MCP] write_file | user=${userId} | path=${relPath} | ERROR: ${mkdirError.message}`);
        return res.status(408).json({
          success: false,
          error: 'Operation timed out (maximum 30 seconds)'
        });
      }
      
      console.error(`[MCP] write_file | user=${userId} | path=${relPath} | ERROR: Failed to create parent directory: ${mkdirError.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to create parent directory'
      });
    }
    
    // Requirement 7.4, 7.5: Write content to file as UTF-8
    try {
      // Requirement 14.5, 14.6: Wrap with 30s timeout
      await withTimeout(
        fs.promises.writeFile(fullPath, content, 'utf8'),
        30000,
        'Write file'
      );
    } catch (writeError) {
      // Check if timeout error
      if (writeError.message && writeError.message.includes('timed out')) {
        console.error(`[MCP] write_file | user=${userId} | path=${relPath} | ERROR: ${writeError.message}`);
        return res.status(408).json({
          success: false,
          error: 'Operation timed out (maximum 30 seconds)'
        });
      }
      
      // Requirement 7.7: Return error if write operation fails
      console.error(`[MCP] write_file | user=${userId} | path=${relPath} | ERROR: ${writeError.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to write file'
      });
    }
    
    const duration = Date.now() - startTime;
    
    // Requirement 7.8, 4.5, 15.1, 15.2, 15.3, 15.4: Audit logging
    console.log(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/write_file | root=${req.projectRoot} | file=${relPath} | size=${content.length} | result=success | duration=${duration}ms`);
    
    // Requirement 1.7, 7.6: Return JSON response with success and data
    return res.status(200).json({
      success: true,
      data: {
        path: relPath,
        fullPath: fullPath
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/write_file | ERROR: ${error.message} | duration=${duration}ms`);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error while writing file'
    });
  }
});

// Requirement 1.4: POST /mcp/search_in_files
router.post('/search_in_files', async (req, res) => {
  const startTime = Date.now();
  const userId = req.userId || 'unknown';
  
  try {
    // Requirement 1.6: Accept JSON body with "parameters" object
    const { parameters } = req.body;
    
    if (!parameters || typeof parameters !== 'object') {
      console.error(`[MCP] search_in_files | user=${userId} | ERROR: Missing parameters object`);
      return res.status(400).json({
        success: false,
        error: 'Request body must contain "parameters" object'
      });
    }
    
    // Requirement 8.1: Extract parameters.query
    const query = parameters.query;
    
    if (!query || typeof query !== 'string' || !query.trim()) {
      console.error(`[MCP] search_in_files | user=${userId} | ERROR: Missing or invalid query parameter`);
      return res.status(400).json({
        success: false,
        error: 'Parameter "query" is required and must be a non-empty string'
      });
    }
    
    // Requirement 8.4: Extract optional parameters.filePattern
    const filePattern = parameters.filePattern || null;
    
    // Requirement 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 14.2: Search in files
    let matches;
    try {
      // Requirement 14.5, 14.6: Wrap with 30s timeout
      matches = await withTimeout(
        searchInFiles(req.projectRoot, query, filePattern, 100),
        30000,
        'Search in files'
      );
    } catch (searchError) {
      // Check if timeout error
      if (searchError.message && searchError.message.includes('timed out')) {
        console.error(`[MCP] search_in_files | user=${userId} | query=${query} | ERROR: ${searchError.message}`);
        return res.status(408).json({
          success: false,
          error: 'Operation timed out (maximum 30 seconds)'
        });
      }
      
      // Requirement 8.9: Return error if search fails
      console.error(`[MCP] search_in_files | user=${userId} | query=${query} | ERROR: ${searchError.message}`);
      return res.status(500).json({
        success: false,
        error: 'Search operation failed'
      });
    }
    
    const duration = Date.now() - startTime;
    const limitReached = matches.length >= 100;
    
    // Requirement 4.5, 15.1, 15.2, 15.3: Audit logging
    console.log(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/search_in_files | root=${req.projectRoot} | query="${query}" | pattern=${filePattern || 'none'} | matches=${matches.length} | limitReached=${limitReached} | result=success | duration=${duration}ms`);
    
    // Requirement 1.7, 8.6: Return JSON response with success and data
    // Requirement 8.8: Return empty array if no matches found
    return res.status(200).json({
      success: true,
      data: {
        matches,
        totalMatches: matches.length,
        limitReached
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/search_in_files | ERROR: ${error.message} | duration=${duration}ms`);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error while searching files'
    });
  }
});

// Requirement 1.5: POST /mcp/delete_file
router.post('/delete_file', async (req, res) => {
  const startTime = Date.now();
  const userId = req.userId || 'unknown';
  
  try {
    // Requirement 1.6: Accept JSON body with "parameters" object
    const { parameters } = req.body;
    
    if (!parameters || typeof parameters !== 'object') {
      console.error(`[MCP] delete_file | user=${userId} | ERROR: Missing parameters object`);
      return res.status(400).json({
        success: false,
        error: 'Request body must contain "parameters" object'
      });
    }
    
    // Requirement 9.1: Extract parameters.path
    const relPath = parameters.path;
    
    if (!relPath || typeof relPath !== 'string') {
      console.error(`[MCP] delete_file | user=${userId} | ERROR: Missing or invalid path parameter`);
      return res.status(400).json({
        success: false,
        error: 'Parameter "path" is required and must be a string'
      });
    }
    
    // Requirement 9.2, 3.1: Use safeResolve to validate and resolve path
    let fullPath;
    try {
      fullPath = safeResolve(req.projectRoot, relPath);
    } catch (pathError) {
      console.error(`[MCP] delete_file | user=${userId} | path=${relPath} | ERROR: ${pathError.message}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid or unsafe path'
      });
    }
    
    const fs = require('fs');
    
    // Requirement 9.6: Check if path points to a file (not directory)
    let stats;
    try {
      stats = await fs.promises.stat(fullPath);
    } catch (statError) {
      // Requirement 9.4: Return 404 if file not found
      console.error(`[MCP] delete_file | user=${userId} | path=${relPath} | ERROR: File not found`);
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    // Requirement 9.7: Return 400 if path is a directory
    if (stats.isDirectory()) {
      console.error(`[MCP] delete_file | user=${userId} | path=${relPath} | ERROR: Cannot delete directory`);
      return res.status(400).json({
        success: false,
        error: 'Cannot delete directory (only files can be deleted)'
      });
    }
    
    // Requirement 9.1: Delete file
    try {
      // Requirement 14.5, 14.6: Wrap with 30s timeout
      await withTimeout(
        fs.promises.unlink(fullPath),
        30000,
        'Delete file'
      );
    } catch (deleteError) {
      // Check if timeout error
      if (deleteError.message && deleteError.message.includes('timed out')) {
        console.error(`[MCP] delete_file | user=${userId} | path=${relPath} | ERROR: ${deleteError.message}`);
        return res.status(408).json({
          success: false,
          error: 'Operation timed out (maximum 30 seconds)'
        });
      }
      
      // Requirement 9.5: Return error if file not deletable
      console.error(`[MCP] delete_file | user=${userId} | path=${relPath} | ERROR: ${deleteError.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete file'
      });
    }
    
    const duration = Date.now() - startTime;
    
    // Requirement 9.8, 4.5, 15.1, 15.2, 15.3, 15.4: Audit logging
    console.log(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/delete_file | root=${req.projectRoot} | file=${relPath} | result=success | duration=${duration}ms`);
    
    // Requirement 1.7, 9.3: Return JSON response with success and data
    return res.status(200).json({
      success: true,
      data: {
        path: relPath,
        deleted: true
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP] ${new Date().toISOString()} | user=${userId} | POST /mcp/delete_file | ERROR: ${error.message} | duration=${duration}ms`);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error while deleting file'
    });
  }
});

module.exports = router;
