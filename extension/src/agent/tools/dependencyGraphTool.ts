/**
 * Dependency Graph Tool — generates interactive dependency graphs.
 * Uses vis-network to create visual representations of module dependencies.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

// Note: vis-network is loaded from CDN in the generated HTML, so no local import needed

export async function generateDependencyGraph(
    args: { 
        dependencies: string;
        title?: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const parsedDependencies = JSON.parse(args.dependencies);
        const title = args.title || 'Dependency Graph';
        
        // Convert dependencies to vis-network format
        const nodes: any[] = [];
        const edges: any[] = [];
        const nodeMap = new Map<string, number>();
        let nodeId = 0;
        
        // Add nodes
        parsedDependencies.forEach((dep: any) => {
            const from = dep.from || dep.source;
            const to = dep.to || dep.target;
            
            if (!nodeMap.has(from)) {
                nodeMap.set(from, nodeId);
                nodes.push({ id: nodeId, label: from });
                nodeId++;
            }
            
            if (!nodeMap.has(to)) {
                nodeMap.set(to, nodeId);
                nodes.push({ id: nodeId, label: to });
                nodeId++;
            }
        });
        
        // Add edges
        parsedDependencies.forEach((dep: any) => {
            const from = dep.from || dep.source;
            const to = dep.to || dep.target;
            edges.push({
                from: nodeMap.get(from),
                to: nodeMap.get(to),
                arrows: 'to'
            });
        });
        
        // Generate HTML with vis-network
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style type="text/css">
        body { font-family: Arial, sans-serif; padding: 20px; margin: 0; }
        h1 { color: #333; }
        #mynetwork { width: 100%; height: 600px; border: 1px solid #ccc; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div id="mynetwork"></div>
    <script type="text/javascript">
        var nodes = new vis.DataSet(${JSON.stringify(nodes)});
        var edges = new vis.DataSet(${JSON.stringify(edges)});
        var container = document.getElementById('mynetwork');
        var data = { nodes: nodes, edges: edges };
        var options = {
            nodes: { shape: 'box', font: { size: 14 } },
            edges: { arrows: 'to' },
            physics: { stabilization: false }
        };
        var network = new vis.Network(container, data, options);
    </script>
</body>
</html>
        `;
        
        // Save to a temporary HTML file
        const timestamp = Date.now();
        const fileName = `kurdbox-dependency-graph-${timestamp}.html`;
        const filePath = `${root.fsPath}/${fileName}`;
        const fileUri = vscode.Uri.file(filePath);
        
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(htmlContent, 'utf8'));
        
        // Open in browser
        await vscode.env.openExternal(fileUri);
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                success: true,
                nodesFound: nodes.length,
                edgesFound: edges.length,
                file: fileName,
                message: `Dependency graph generated and opened in browser`
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Dependency graph generation error: ${e.message}`,
            isError: true
        };
    }
}

export const DEPENDENCY_GRAPH_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'generate_dependency_graph',
            description: 'Generate an interactive dependency graph visualization. Takes a JSON array of dependency relationships (from/to or source/target) and creates an interactive graph using vis-network.',
            parameters: {
                type: 'object',
                properties: {
                    dependencies: {
                        type: 'string',
                        description: 'JSON string array of dependency relationships. Example: [{"from":"moduleA","to":"moduleB"},{"from":"moduleB","to":"moduleC"}]'
                    },
                    title: {
                        type: 'string',
                        description: 'Optional title for the graph'
                    }
                },
                required: ['dependencies']
            }
        }
    }
];
