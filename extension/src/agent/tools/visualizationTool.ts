/**
 * Visualization Tool — generates visual representations of data.
 * Supports generating HTML/SVG visualizations for data analysis.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

// Note: d3 is conditionally imported but not strictly required for basic HTML generation
// The tool works without d3 for simple HTML visualizations

export async function generateVisualization(
    args: { 
        type: 'bar' | 'line' | 'pie' | 'tree';
        data: string;
        title?: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const parsedData = JSON.parse(args.data);
        const title = args.title || 'Visualization';
        
        let htmlContent = '';
        
        switch (args.type) {
            case 'bar':
                htmlContent = generateBarChart(parsedData, title);
                break;
            case 'line':
                htmlContent = generateLineChart(parsedData, title);
                break;
            case 'pie':
                htmlContent = generatePieChart(parsedData, title);
                break;
            case 'tree':
                htmlContent = generateTreeVisualization(parsedData, title);
                break;
            default:
                return {
                    tool_call_id: callId,
                    role: 'tool',
                    content: `Unsupported visualization type: ${args.type}. Supported: bar, line, pie, tree`,
                    isError: true
                };
        }
        
        // Save to a temporary HTML file
        const timestamp = Date.now();
        const fileName = `kurdbox-viz-${timestamp}.html`;
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
                type: args.type,
                file: fileName,
                message: `Visualization generated and opened in browser`
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Visualization generation error: ${e.message}`,
            isError: true
        };
    }
}

function generateBarChart(data: any[], title: string): string {
    const maxVal = Math.max(...data.map(d => d.value || 0));
    const bars = data.map((d, i) => {
        const value = d.value || 0;
        const height = (value / maxVal) * 100;
        const label = d.label || `Item ${i}`;
        return `
            <div style="display: flex; align-items: center; margin: 10px 0;">
                <div style="width: 150px; text-align: right; margin-right: 10px;">${label}</div>
                <div style="flex: 1; background: #f0f0f0; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${height}%; background: #4CAF50; height: 30px; border-radius: 4px;"></div>
                </div>
                <div style="margin-left: 10px; width: 50px;">${value}</div>
            </div>
        `;
    }).join('');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    ${bars}
</body>
</html>
    `;
}

function generateLineChart(data: any[], title: string): string {
    const points = data.map((d, i) => `${i * 50},${100 - (d.value || 0)}`).join(' ');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <svg width="500" height="100" style="border: 1px solid #ccc;">
        <polyline points="${points}" style="fill: none; stroke: #4CAF50; stroke-width: 2;" />
    </svg>
</body>
</html>
    `;
}

function generatePieChart(data: any[], title: string): string {
    const total = data.reduce((sum, d) => sum + (d.value || 0), 0);
    let currentAngle = 0;
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0'];
    const slices = data.map((d, i) => {
        const value = d.value || 0;
        const percentage = (value / total) * 100;
        const angle = (percentage / 100) * 360;
        const color = colors[i % colors.length];
        const slice = `
            <div style="display: flex; align-items: center; margin: 5px 0;">
                <div style="width: 20px; height: 20px; background: ${color}; margin-right: 10px; border-radius: 50%;"></div>
                <div>${d.label || `Item ${i}`}: ${percentage.toFixed(1)}%</div>
            </div>
        `;
        currentAngle += angle;
        return slice;
    }).join('');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    ${slices}
</body>
</html>
    `;
}

function generateTreeVisualization(data: any, title: string): string {
    function renderNode(node: any, depth: number = 0): string {
        const indent = depth * 20;
        const children = node.children || [];
        const childNodes = children.map((child: any) => renderNode(child, depth + 1)).join('');
        
        return `
            <div style="margin-left: ${indent}px; padding: 5px 0;">
                <div style="font-weight: bold;">${node.name || 'Node'}</div>
                ${node.value ? `<div style="color: #666; font-size: 0.9em;">${node.value}</div>` : ''}
                ${childNodes}
            </div>
        `;
    }
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    ${renderNode(data)}
</body>
</html>
    `;
}

export const VISUALIZATION_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'generate_visualization',
            description: 'Generate visual representations of data as HTML/SVG files. Supports bar charts, line charts, pie charts, and tree visualizations. Opens the visualization in a browser.',
            parameters: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        description: 'Visualization type: bar, line, pie, or tree'
                    },
                    data: {
                        type: 'string',
                        description: 'JSON string of data to visualize. Format depends on type.'
                    },
                    title: {
                        type: 'string',
                        description: 'Optional title for the visualization'
                    }
                },
                required: ['type', 'data']
            }
        }
    }
];
