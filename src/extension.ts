// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { request } from 'https';
import { TextEncoder } from 'util';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let rejectUnauthorized: boolean = false;
	let activated: boolean = false;
	let queuedGeneration: string[] = [];
	let queueLock: boolean = false;
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "codex" is now active!');
	
	let startSession = vscode.commands.registerCommand('codex.startSession', async () => {
		activated = true;
		context.workspaceState.update('@codex.model', '/v1/engines/davinci-codex/completions');
		let model = await vscode.window.showInputBox({
			placeHolder: '/v1/engines/davinci-codex/completions',
			prompt: 'Enter the model to use for the codex session',
			title: 'Codex Model',
		});
		if (model === undefined) {
			console.log(context.workspaceState.get('@codex.model', ''));
		} else {
			// console.log("Bood: ", model);
			context.workspaceState.update('@codex.model', model);

		}
		let apiKey = context.workspaceState.get('@codex.key', '');
		// console.log(apiKey);
		if (!apiKey || !context.workspaceState.get('@key.verified', true)) {
			let key = await vscode.window.showInputBox({
				password: true,
				title: 'CODEX API key',
				prompt: "Enter API Key here..."
			});
			if (key === undefined) {
				vscode.window.showErrorMessage("The key entered is empty or invalid, please try again..");
				activated = false;
				return;
			} else {
				context.workspaceState.update('@codex.key', key);
				apiKey = context.workspaceState.get('@codex.key', '');
			}
		}
		verifyAPIKey(apiKey, context);
	});
	context.subscriptions.push(startSession);

	let generateAutoComplete = vscode.commands.registerCommand('codex.generateAutoComplete', async () => {
		// console.log("Hello World! started working!");

		if (!activated) {
			vscode.window.showErrorMessage("The session is not activated");
			await vscode.commands.executeCommand('codex.startSession');
		}
		const editor = vscode.window.activeTextEditor;
		const openDoc = editor?.document;

		
		if (openDoc !== undefined && editor !== undefined) {
			while (queueLock) {}
			queueLock = true;
			if (queuedGeneration.findIndex(val => val === openDoc.fileName) !== -1) {
				vscode.window.showErrorMessage("Code generation is already running.");
				queueLock = false;
				return;
			} else {
				queueLock = false;
			}
			
			// get the selected text from the openDoc
			const selection = editor.selection;
			const selectedText = openDoc.getText(selection);
			console.log(selectedText);
			// console.log(selectedText.length);
			if (selectedText.length === 0) {
				const fileContent = openDoc.getText();
				generateCompletion(context, fileContent, editor, openDoc, new vscode.Position(openDoc.lineCount - 1, openDoc.lineAt(openDoc.lineCount - 1).range.end.character));
			} else {
				generateCompletion(context, selectedText, editor, openDoc, selection.end);
			}
			
			
		} else {
			return;
		}

	});
	context.subscriptions.push(generateAutoComplete);

	let changeAPIKey = vscode.commands.registerCommand('codex.changeAPIKey', async () => {
		let key = await vscode.window.showInputBox({
			password: true,
			title: 'CODEX API key',
			prompt: "Enter API Key here..."
		});
		if (key === undefined) {
			vscode.window.showErrorMessage("The key entered is empty or invalid, please try again..");
			return;
		} else {
			context.workspaceState.update('@codex.key', key);
			vscode.window.showInformationMessage("Key accepted, Verifying...");
		}
		verifyAPIKey(key, context);
	});
	context.subscriptions.push(changeAPIKey);

	let changeSettings = vscode.commands.registerCommand('codex.changeSettings', async () => {
		const selected = await vscode.window.showQuickPick([
			'temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'model'
		], {
			canPickMany: false,
			title: 'Change Parameters'
		});

		let options: vscode.InputBoxOptions = {};
		if (selected === 'temperature') {
			options = {
				title: 'Temperature [0, 1]',
				placeHolder: '0',
				prompt: 'Temperature is a floating point no. (eg. 0.7)'
			};
		} else if (selected === 'max_tokens') {
			options = {
				title: "max_tokens [1, 4096]",
				placeHolder: '128',
				prompt: 'max_tokens is no. of tokens generated'
			};
		} else if (selected === 'top_p') {
			options = {
				title: "top_p [0, 1]",
				placeHolder: '1',
				prompt: 'Controls diversity'
			};
		} else if (selected === 'frequency_penalty') {
			options = {
				title: "Frequency_penalty [0, 2]",
				placeHolder: '0',
				prompt: 'Decrease models repeatability'
			};
		} else if (selected === 'presence_penalty') {
			options = {
				title: 'Presence Penalty [0, 2]',
				placeHolder: '0',
				prompt: 'increase likelihood of creativity',
			};
		} else if (selected === 'model') {
			options = {
				title: 'Model',
				placeHolder: '/v1/engines/davinci-codex/completions',
				prompt: 'Change the model',
			};
		}

		if (selected !== 'model') {
			options.validateInput = (userIn: string): any => {
				if (!parseFloat(userIn)) {
					return 'The input must be a number';
				}
				return null;		
			};
		}
		const value = await vscode.window.showInputBox(options);
		if (value === undefined) {
			return;
		}
		if (selected === 'temperature') {
			const num = parseFloat(value);
			if (num) {
				if (num < 0 || num > 1) {
					vscode.window.showWarningMessage(`Codex:Invalid Temperature entered ${num}`);
				} else {
					context.workspaceState.update('@codex.temperature', num);
				}
			}
		} else if (selected === 'max_tokens') {
			const num = parseInt(value);
			if (num) {
				if (num > 0 && num <= 4096) {
					context.workspaceState.update("@codex.max_tokens", num);
				} else {
					vscode.window.showWarningMessage(`Codex: Invalid value for max_tokens ${num}`);
				
				}
			}
		} else if (selected === 'top_p') {
			const num = parseFloat(value);
			if (num) {
				if (num >= 0 && num <= 1) {
					context.workspaceState.update("@codex.top_p", num);
				} else {
					vscode.window.showWarningMessage(`Codex: Invalid value for top_p ${num}`);
				
				}
			}
		} else if (selected === 'frequency_penalty') {
			const num = parseFloat(value);
			if (num) {
				if (num >= 0 && num <= 2) {
					context.workspaceState.update("@codex.frequency_penalty", num);
				} else {
					vscode.window.showWarningMessage(`Codex: Invalid value for frequency_penalty ${num}`);
				
				}
			}
		} else if (selected === 'presence_penalty') {
			const num = parseFloat(value);
			if (num) {
				if (num >= 0 && num <= 2) {
					context.workspaceState.update("@codex.presence_penalty", num);
				} else {
					vscode.window.showWarningMessage(`Codex: Invalid value for presence_penalty ${num}`);
				
				}
			}
		} else if (selected === 'model') {
			context.workspaceState.update("@codex.model", value);
		}
	});
	context.subscriptions.push(changeSettings);

	let resetSettings = vscode.commands.registerCommand('codex.resetSettings', async () => {
		context.workspaceState.update('@codex.temperature', 0);
		context.workspaceState.update('@max_tokens', 128);
		context.workspaceState.update('@codex.top_p', 1);
		context.workspaceState.update('@codex.frequency_penalty', 0);
		context.workspaceState.update('@codex.presence_penalty', 0);
	});
	context.subscriptions.push(resetSettings);

	context.subscriptions.push(
		vscode.commands.registerCommand('codex.showSettings', async () => {
			const panel = vscode.window.createWebviewPanel(
				'showSettings',
				'View Settings',
				vscode.ViewColumn.One,
				{}
			);

			const webContent = () => {
				return `<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Cat Coding</title>
					<style>
						table {
							padding: 1em;
							width: 80vw;
						}
						td {
							border: 1px solid black;
							text-align: center;
						}
					</style>
				</head>
				<body>
					<h1>Settings</h1>
					<table style="border: 1px solid black;">
						<tr>
							<th>
								<h2>Settings</h2>
							</th>
							<th>
								<h2>
									Values
								</h2>
							</th>
						</tr>
						<tr>
							<td><h2>temperature: </h2></td>
							<td><h2>${context.workspaceState.get('@codex.temperature', 0)}</h2></td>
						</tr>
						<tr>
							<td><h2>max_tokens: </h2></td>
							<td><h2>${context.workspaceState.get('@codex.max_tokens', 128)}</h2></td>
						</tr>
						<tr>
							<td><h2>top_p: </h2></td>
							<td><h2>${context.workspaceState.get('@codex.top_p', 1)}</h2></td>
						</tr>
						<tr>
							<td><h2>frequency_penalty: </h2></td>
							<td><h2>${context.workspaceState.get('@codex.frequency_penalty', 0)}</h2></td>
						</tr>
						<tr>
							<td><h2>presence_penalty: </h2></td>
							<td><h2>${context.workspaceState.get('@codex.presence_penalty', 0)}</h2></td>
						</tr>
						<tr>
							<td><h2>model: </h2></td>
							<td><h2>${context.workspaceState.get('@codex.model', 'en')}</h2></td>
					</table>
				</body>
				</html>`;
			};

			panel.webview.html = webContent();
		})
	);




	// Helper functions

	function httpsRequest(options: {rejectUnauthorized: boolean, hostname: string; path: string; method: string; headers: { 'Content-Type': string; Authorization: string; }; }, data: Uint8Array, responeHandler: any) {
		return new Promise((resolve, reject) => {
			let req = request(options, res => {
				responeHandler(res, resolve, reject);
			});
			req.write(data);
			req.end();
		});
	}

	function verifyAPIKey(key: string, context: vscode.ExtensionContext) {

		const options = {
			rejectUnauthorized: rejectUnauthorized,
			hostname: 'api.openai.com',
			path: `${context.workspaceState.get('@codex.model', '/v1/engines/davinci-codex/completions')}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${key}`
			},
		
		};
		const data = new TextEncoder().encode(
			JSON.stringify({
				'prompt': "",
				'temperature': 0,
				'max_tokens': 1,
				'top_p': 1,
				'frequency_penalty': 0,
				'presence_penalty': 0
			})
		);
	
		const handler = (res: any, resolve: any, reject: any) => {
			try {
				if (res.statusCode === 200) {
					context.workspaceState.update('@key.verified', true);
					vscode.window.showInformationMessage('The key has been verified!');
					resolve(true);
				}
				else {
					context.workspaceState.update('@key.verified', false);
					vscode.window.showErrorMessage('The key verification failed!');
					resolve(false);
				}
			} catch (err) {
				reject(err);
			}
		};
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Verifying the API key...",
			cancellable: false
		}, async (progress, token) => {
			progress.report({ increment: 0 });
			for (let i = 0; i < 10; ++i) {
				setTimeout(() => {
					progress.report({ increment: i * 10 });
				}, i* 500);
			}
	
			await httpsRequest(options, data, handler);
			progress.report({increment: 100});
		});
	}
	
	function generateCompletion(context: vscode.ExtensionContext, text: string, editor: vscode.TextEditor, openDoc: vscode.TextDocument, eof: vscode.Position) {
		queuedGeneration.push(openDoc.fileName);
		const options = {
			rejectUnauthorized: rejectUnauthorized,
			hostname: 'api.openai.com',
			path: `${context.workspaceState.get('@codex.model', '/v1/engines/davinci-codex/completions')}`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${context.workspaceState.get('@codex.key', '')}`
			}
		};

		const data = new TextEncoder().encode(
			JSON.stringify({
				'prompt': text,
				'temperature': context.workspaceState.get('@codex.temperature', 0),
				'max_tokens': context.workspaceState.get('@codex.max_tokens', 128),
				'top_p': context.workspaceState.get('@codex.top_p', 1),
				'frequency_penalty': context.workspaceState.get('@codex.frequency_penalty', 0),
				'presence_penalty': context.workspaceState.get('@codex.presence_penalty', 0)

			})
		);

		const handler = (res: any, resolve: any, reject: any) => {
			try {	
				if (res.statusCode !== 200) {
					vscode.window.showErrorMessage("API Key Invalid | API Expired");
					resolve(false);
					return;
				}
				res.on('data', (data: any) => {
					console.log("Recieved Data: ");

					const recievedData = JSON.parse(data);
					editor.edit(edit => { 

						edit.insert(eof, recievedData.choices[0].text);
					});

					
				});
				resolve(true);
			} catch(err) {
				reject(err);
			} finally {
				while (queueLock) {}
				queueLock = true;
				const index = queuedGeneration.findIndex(val => val === openDoc.fileName);
				if (index !== -1) {
					queuedGeneration.splice(index, 1);
				}
				queueLock = false;
			}
		};
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Fetching code from openAI Codex",
			cancellable: false
		}, async (progress, token) => {
			progress.report({ increment: 0 });
			for (let i = 0; i < 20; ++i) {
				setTimeout(() => {
					progress.report({ increment: 5 });
				}, i* 500);
			}
			console.log("Making Request!");
			await httpsRequest(options, data, handler);
			progress.report({increment: 100, message: "Code recieved successfully"});
			const filename = openDoc.uri.path.split('/').pop();
			vscode.window.showInformationMessage(`The Code is added in ${filename}`);
		});
		
		

	}
}








// this method is called when your extension is deactivated
export function deactivate() {}




