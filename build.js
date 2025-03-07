//#region Imports and Utilities
"use strict";

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

function exitWithError(message, ...optionalParams) {
	console.error(...arguments);
	process.exit(1);
}

const jsoncUtil = {
	/** Removes comments and trailing commas from the jsonc formatted string. */
	stringToJson: function (jsonc) {
		let result = jsonc.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
		result = result.replace(/,(\s*[\]}])/g, '$1');
		result = result.replace(/"\$schema": ".*",?/g, '');
		result = result.replace(/^\s*[\r\n]/gm, '');
		// Special case for empty objects that had inner content removed
		result = result.replace(/\{\s*\}/g, '{}');
		return result;
	},
	readObject: (file) => {
		try { return JSON.parse(jsoncUtil.stringToJson(fs.readFileSync(file, 'utf8'))) }
		catch (err) {
			exitWithError(`File ${file} is not a valid JSON file: ${err}`);
		}
	},
}

// Load configuration
const configPath = path.join(process.cwd(), 'source', 'shared', 'bs-ts-template.jsonc');
if (!fs.existsSync(configPath)) {
    exitWithError("You must run 'npx bga-init' before running 'npx bga-build'! 'npx bga-init' will create this build script based on your project's parameters defined by the init arguments. ");
}
const config = jsoncUtil.readObject(configPath);
if (!config.YourGameName || !config.developers || !config.source) {
	const requiredFields = ['YourGameName', 'developers', 'source'];
	const missing = requiredFields.filter(f => !config[f]);
	exitWithError(`Invalid config: Missing ${missing.join(', ')}`);
}
const yourgamename = config.YourGameName.toLowerCase();
const sourceFolder = path.normalize(config.source) + path.sep;
const sourceToTemplate = path.normalize(config["source-to-template"]) + path.sep;

const builder = {
	watch: process.argv.includes('--watch') ?
		(file, callback) => {
			try { fs.watch(file, { encoding: 'buffer' }, callback) }
			catch (err) { }
		} : null,
	commands: [],
	watchCommand: (message, watchfile, callback) => builder.commands.push({
		message: message,
		callback: () => {
			try { callback(); }
			catch (err) {
				if (builder.watch)
					console.error(err.message);
				else throw err;
			}
			if (watchfile && builder.watch)
				builder.watch(watchfile, (eventType, filename) => {
					console.log(`${watchfile} changed. ` + message + '...');
					try { callback(); }
					catch (err) {
						console.error(err.message);
					}
				});
		}
	}),
	execCommand: (message, command) => builder.commands.push({
		message: message,
		callback: () => {
			if (builder.watch)
				exec(command, { stdio: 'inherit' });
			else {
				builder.execSync(command);
			}
		}
	}),
	execSync: (command) => {
		try { execSync(command, { stdio: 'inherit' }); }
		catch (err) {
			console.error(err.message);
			process.exit(1);
		}
	}
};

//#endregion

//#region JSON Writer

const writer = {
	typescript_type_properties: new Set([]),
	php_translated_properties: new Set(['description', 'descriptionmyturn']),
	translateFunc: 'clienttranslate',
	indent: 0,
	inTSProperty: 0,
	fileSignature:
`/*
 * THIS FILE HAS BEEN AUTOMATICALLY GENERATED. ANY CHANGES MADE DIRECTLY MAY BE OVERWRITTEN.
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * ${config.YourGameName} implementation : © ${config.developers}
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 */
`,
	buffer: null,
	recursion: 0,
	stringify: (obj, isPHP, tsprop = false) => {
		if (tsprop) writer.inTSProperty++;
		if (writer.recursion === 0)
			writer.buffer = '';
		writer.recursion++;
		const type = typeof obj;
		switch (type) {
			case 'object':
				if (obj === null) {
					writer.buffer += 'null';
					break;
				}
				// If this is an array:
				if (Array.isArray(obj)) {
					writer.buffer += '[';
					for (let i = 0; i < obj.length; i++) {
						writer.stringify(obj[i], isPHP);
						if (i < obj.length - 1) {
							writer.buffer += ', ';
						}
					}
					writer.buffer += ']';
					break;
				}

				if (Object.entries(obj).length === 0) {
					writer.buffer += isPHP ? 'array()' : '{}';
					break;
				}
	
				writer.buffer += isPHP ? 'array(\n' : '{\n';
				writer.indent++;
				for (const key in obj) {
					// if is parsable as int
					if (writer.php_translated_properties.has(key) && obj[key] !== '' && isPHP) {
						writer.buffer += '\t'.repeat(writer.indent);
						writer.buffer += `'${key}' => ${writer.translateFunc}('${obj[key]}'),\n`;
					}
					else {
						if (writer.typescript_type_properties.has(key))
							writer.inTSProperty++;
						
						if (writer.inTSProperty == 0 || !isPHP)
						{
							writer.buffer += '\t'.repeat(writer.indent);
							if (!isNaN(parseInt(key))) {
								writer.buffer += isPHP ? `${key} => ` : `${key}: `;
							} else {
								writer.buffer += isPHP ? `'${key}' => ` : `'${key}': `;
							}
							
							writer.stringify(obj[key], isPHP);
							writer.buffer += ',\n';
						}
	
						if (writer.typescript_type_properties.has(key))
							writer.inTSProperty--;
					}
				}
				writer.indent--;
				writer.buffer += '\t'.repeat(writer.indent);
				writer.buffer += isPHP ? ')' : '}';
	
				break;
			case 'string':
				// stringify with single quotes:
				let jsonString = JSON.stringify(obj);
				jsonString = jsonString.substring(1, jsonString.length - 1);
				if (writer.inTSProperty > 0)
					writer.buffer += jsonString;
				else {
					writer.buffer += `'${jsonString.replace(/'/g, "\\'").replace(/\\"/g, '"')}'`;
				}
				break;
			case 'number':
				writer.buffer += obj.toString();
				break;
			case 'boolean':
				writer.buffer += obj ? 'true' : 'false';
				break;
			case 'undefined':
				console.error(`Value type of 'undefined' should not be printing to json/php file. This is likely an internal error.`);
				writer.buffer += 'undefined';
				break;
			default:
				console.error(`Unsupported value type in json/php file: ${type}. Value: ${obj}`);
				writer.buffer += obj?.toString() ?? 'null';
				break;
		}

		writer.recursion--;
		if (tsprop) writer.inTSProperty--;
		return writer.buffer;
	}
}

//#endregion

//#region Game States
if (fs.existsSync(path.join(sourceFolder, 'shared/gamestates.jsonc')))
{
	builder.watchCommand("Game States: 'gamestates.jsonc' => 'states.inc.php', '.action.php', [gamestates.d.ts]", path.join(sourceFolder, 'shared/gamestates.jsonc'), () => {
		if (!fs.existsSync(path.join(sourceFolder, 'shared/gamestates.jsonc'))) {
			console.error(`File not found: ${path.join(sourceFolder, 'shared/gamestates.jsonc')}`);
			return;
		}

		let statesJSON = jsoncUtil.readObject(path.join(sourceFolder, 'shared/gamestates.jsonc'));

		// #region Validate+Autofill

		Set.prototype.tryAdd = function (value) {
			let length = this.size;
			this.add(value);
			return length !== this.size;
		}

		const stateIds = new Set();
		// Check for duplicate state ids and names. Also make sure the game end and start states are present.
		{
			const stateNames = new Set();
			const hasEndState = false;
			for (const key in statesJSON) {
				const state = statesJSON[key];

				if (!stateIds.tryAdd(key))
					exitWithError(`Multiple states have the same id: ${key}. States: ${Object.entries(statesJSON).filter(([k, v]) => k === key).map(([k, v]) => v.name).join(', ')}`);

				if (state.name === undefined)
					exitWithError(`State ${key} does not have a name.`);

				if (!stateNames.tryAdd(state.name))
					exitWithError(`Multiple states have the same name: ${state.name}. States: ${Object.entries(statesJSON).filter(([k, v]) => v.name === state.name).map(([k, v]) => k + ` (${v})`).join(', ')}`);

				if (state.action === 'stGameEnd' && hasEndState) {
					exitWithError('There are multiple Game End states: ' + Object.entries(statesJSON).filter(([k, v]) => v.action === 'stGameEnd').map(([k, v]) => k + ` (${v.name})`).join(', '));
				}

				if (state.action === 'stGameSetup' && key !== '1') {
					exitWithError('There is a state with the action stGameSetup but does not have the id 1: ' + key + ` (${state.name})`);
				}
			}

			// Make sure there is a game start and game end state
			if (!stateIds.has('1'))
				exitWithError('There is no Game Setup state with id 1.');
		}


		// Make sure that only the stGameSetup and stGameEnd actions are typed as manager. Also, make sure all 'game' and 'manager' states have an action.
		for (const key in statesJSON) {
			const state = statesJSON[key];
			if (state.type === 'manager')
			{
				if (state.action !== 'stGameSetup' && state.action !== 'stGameEnd') {
					exitWithError(`State ${key} ("${state.name}") is typed as 'manager' but is not the Game Setup or Game End state.`);
				}
				if (state.action === 'stGameSetup' && key !== '1') {
					exitWithError(`State ${key} ("${state.name}") is typed as 'manager' and is the Game Setup state, but does not have the id 1.`);
				}
			}
			else if (state.type === 'game') {
				if (!state.action)
					exitWithError(`State ${key} ("${state.name}") is typed as 'game' but does not have an action.`);
			}
			else if (state.type === undefined) {
				exitWithError(`State ${key} ("${state.name}") does not have a type.`);
			}
			else if (state.type !== 'multipleactiveplayer' && state.type !== 'activeplayer' && state.type !== 'private') {
				exitWithError(`State ${key} ("${state.name}") does not have a valid type: ${state.type}.`);
			}
		}

		// Check if description/descriptionmyturn is set when the state type is not 'game':
		for (const key in statesJSON) {
			const state = statesJSON[key];

			if (!state.description) {
				if (state.type !== 'game' && state.type !== 'manager') {
					exitWithError(`State ${key} ("${state.name}") is not of type 'game' nor 'manager' and does not have a description. If this is intended, set the description to an empty string.`);
				}
				state.description = '';
			}
			else state.description = state.description.toString();
			if (!state.descriptionmyturn) {
				if (state.type !== 'game' && state.type !== 'manager') {
					exitWithError(`State ${key} ("${state.name}") is not of type 'game' nor 'manager' and does not have a descriptionmyturn. If this is intended, set the descriptionmyturn to an empty string.`);
				}
			}
		}

		// Validate that all transitions are unique and have a valid target state id
		for (const key in statesJSON) {
			const state = statesJSON[key];
			const transitions = state.transitions;

			if (!transitions) {
				if (state.action !== 'stGameEnd')
					exitWithError(`State ${key} ("${state.name}") does not have any transitions. This is only ever valid on the Game End state.`);
				continue;
			}

			if (typeof transitions !== 'object')
				exitWithError(`Transitions in state ${key} ("${state.name}") is not an object.`);

			const transitionNames = new Set();
			for (const transition in transitions) {
				if (transitionNames.has(transition)) {
					exitWithError(`Transition named "${transition}" is duplicated in state ${key} ("${state.name}").`);
				}
				transitionNames.add(transition);

				if (!stateIds.has(transitions[transition].toString())) {
					exitWithError(`Transition named "${transition}" in state ${key} ("${state.name}") points to a non-existing state id ${transitions[transition]}. State Ids: ${Array.from(stateIds).map(id => `${id} (${statesJSON[id].name})`).join(', ')}`);
				}
			}

			if (transitionNames.size === 0) {
				exitWithError(`State ${key} ("${state.name}") has no transitions. This is not valid and only the End game state should have no transitions defined (not an empty object).`);
			}
		}

		// Validate that all possible actions are unique and if they share a name with another states possible actions, their values are the same.
		/** Compares the parameters defined by two possibleactions entries to see if they contain the same data. */
		function actionsAreEqual(aParams, bParams) {
			if (aParams.length !== bParams.length)
				return false;

			const keys = ['name', 'type', 'argTypeDetails', 'bCanFail', 'mandatory', 'typescriptType'];
			for (let i = 0; i < aParams.length; i++) {
				if (keys.some(k => aParams[i][k] !== bParams[i][k]))
					return false;
			}
		}

		const possibleActions = new Map();
		for (const key in statesJSON) {
			const state = statesJSON[key];
			const actions = state.possibleactions;

			if (!actions) {
				if (state.type !== 'game' && state.type !== 'manager')
					exitWithError(`State ${key} ("${state.name}") does not have any possibleactions. This is only ever valid on states with type 'game' or 'manager'.`);
				continue;
			}

			if (typeof actions !== 'object')
				exitWithError(`Possible actions in state ${key} ("${state.name}") is not an object. When defining states a jsonc file, the actions are keys of an object, with the value being an (ordered) array of parameters the client needs to send.`);

			for (const action in actions) {
				if (!possibleActions.has(action)) {
					possibleActions.set(action, actions[action]);
				} else if (actionsAreEqual(possibleActions.get(action), actions[action])) {
					exitWithError(`Action named "${action}" in state ${key} ("${state.name}") has a different value than the same action name in another state.`);
				}

				if (!Array.isArray(actions[action]))
					exitWithError(`Possible action "${action}" in state ${key} ("${state.name}") is not an object. When defining states a jsonc file, the actions are keys of an object, with the value being an (ordered) array of parameters the client needs to send.`);

				let counter = 0;
				for (const parameter of actions[action]) {
					counter++;

					if (parameter.name === undefined || typeof parameter.name !== 'string') {
						exitWithError(`Parameter number ${counter} in action ${action} in state ${key} ("${state.name}") does not have a name (or it is not a string).`);
					}

					if (parameter.type === 'AT_enum') {
						if (!parameter.argTypeDetails) {
							exitWithError(`Action ${action} in state ${key} ("${state.name}") has a parameter with type 'AT_enum' but no argTypeDetails.`);
						}
					}
					else if (parameter.argTypeDetails) {
						exitWithError(`Action ${action} in state ${key} ("${state.name}") has argTypeDetails but is not of type 'AT_enum'.`);
					}
					else if (parameter.type === undefined) {
						exitWithError(`Parameter number ${counter} (${parameter.name}) in ${action} in state ${key} ("${state.name}") has a parameter without a type.`);
					}
				}
			}
		}

		// Check that all args and argsType are the same.
		const argsTypes = {};
		for (const key in statesJSON) {
			const state = statesJSON[key];
			const args = state.args;
			let argsType = state.argsType;

			if (!args && !argsType)
				continue;
			else if (!args && argsType)
				exitWithError(`State ${key} ("${state.name}") has an argsType defined but no args.`);
			else if (args && !argsType)
				argsType = 'object';

			if (args == 'argGameEnd') {
				// Already defined in the source code
				if (argsType !== 'object' && argsType !== 'any')
					exitWithError(`State ${key} ("${state.name}") has args defined as 'argGameEnd' but the args type, '${argsType}', is not 'any' or 'object'. This argsType is already defined in the framework and should be omitted from this state.`);
			}
			else if (!(args in argsTypes))
				argsTypes[args] = argsType;
			else if (argsTypes[args] !== argsType)
				exitWithError(`State ${key} ("${state.name}") has a different args type than another state with the same args function.`);
		}

		// Add typescriptTypes to all possibleaction parameters:
		const actionTypes = {};
		for (const key in statesJSON) {
			const state = statesJSON[key];
			const actions = state.possibleactions;

			if (!actions) continue;

			for (const action in actions) {
				if (action in actionTypes) continue;

				let parameters = actions[action];
				let type = {};

				for (let parameter of parameters) {
					if (parameter["typescriptType"]) {
						if (parameter.type == 'AT_enum')
							exitWithError(`Action ${action} in state ${key} ("${state.name}") has a parameter with type 'AT_enum'. Enums are listed using argTypeDetails and is automatically converted to typescript string literal union.`);
						type[parameter.name] = parameter["typescriptType"];
						continue;
					}

					switch (parameter.type) {
						case "AT_int":
						case "AT_posint":
						case "AT_float":
							type[parameter.name] = "number";
							break;
						case "AT_email":
							type[parameter.name] = "`${string}@${string}.${string}`";
							break;
						case "AT_bool":
							type[parameter.name] = "boolean";
							break;
						case "AT_enum":
							type[parameter.name] = Array.from(new Set(parameter.argTypeDetails.map(e => `'${e}'`))).join(' | ');
							break;
						case "AT_login":
						case "AT_url":
						case "AT_alphanum":
						case "AT_username":
						case "AT_numberlist":
						case "AT_uuid":
						case "AT_version":
						case "AT_cityname":
						case "AT_filename":
						case "AT_groupname":
						case "AT_timezone":
						case "AT_mediawikipage":
						case "AT_html_id":
						case "AT_alphanum_dash":
						case "AT_date":
						case "AT_num":
						case "AT_alpha_strict":
						case "AT_namewithaccent":
						case "AT_json":
						case "AT_base64":
							type[parameter.name] = "string";
							break;
						default:
							exitWithError(`Unknown parameter type: ${parameter.type}`);
							break;
					}
				}

				actionTypes[action] = type;
			}
		}

		// Validate that all defined 'initialprivate' are on type 'multipleactiveplayer' states and target states which are 'private'
		for (const key in statesJSON) {
			const state = statesJSON[key];
			const initialprivate = state.initialprivate;

			if (initialprivate) {
				if (state.type !== 'multipleactiveplayer')
					exitWithError(`State ${key} ("${state.name}") has initialprivate defined as '${initialprivate}' but is not of type 'multipleactiveplayer'.`);

				if (!statesJSON[initialprivate])
					exitWithError(`State ${key} ("${state.name}") has initialprivate defined as '${initialprivate}', but that state does not exist.`);

				if (statesJSON[initialprivate].type !== 'private')
					exitWithError(`State ${key} ("${state.name}") has initialprivate defined as '${initialprivate}', but that state ("${statesJSON[initialprivate].name}") is not of type 'private'.`);
			}
		}

		//#endregion

		for (const key in statesJSON) {
			if (statesJSON[key].possibleactions) {
				statesJSON[key].possibleactions = Object.keys(statesJSON[key].possibleactions);
			}
			delete statesJSON[key].argsType;
		}

		// #region Write .d.ts
		if (fs.existsSync(path.join(sourceFolder, 'client/tsconfig.json')))
		{
			const buildPath = path.join(sourceFolder, 'client/build/');
			if (!fs.existsSync(buildPath))
				fs.mkdirSync(buildPath, { recursive: true });

			fs.writeFileSync(path.join(buildPath, 'gamestates.d.ts'),
`${writer.fileSignature}
declare namespace BGA {

interface DefinedGameStates extends ValidateGameStates<${writer.stringify(statesJSON, false)}> {}

interface GameStateArgs ${writer.stringify(argsTypes, false, true)}

interface GameStatePossibleActions ${writer.stringify(actionTypes, false, true)}

}`);
		}

		//#endregion

		// #region Write states.inc.php

		fs.writeFileSync('states.inc.php',
`<?php
declare(strict_types=1);
${writer.fileSignature}
/**
 * TYPE CHECKING ONLY, this function is never called.
 * If there are any undefined function errors here, you MUST rename the action within the game states file, or create the function in the game class.
 * If the function does not match the parameters correctly, you are either calling an invalid function, or you have incorrectly added parameters to a state function.
 */
if (false) {
	/** @var ${yourgamename} $game */
	${Object.values(statesJSON)
		.filter(state => state.action !== undefined && state.type !== 'manager')
		.map(state => `$game->${state.action}();`)
		.join('\n\t')
	}
}

$machinestates = ${writer.stringify(statesJSON, true)};`
);
		// #endregion

		// #region Write .action.php
		const pType = (parameter) => {
			return parameter.type === 'AT_float' ? 'float' :
				parameter.type === 'AT_int' ? 'int' :
				parameter.type === 'AT_posint' ? 'int' :
				parameter.type === 'AT_bool' ? 'bool' :
				'string';
		};
		const pArgs = (parameter) => {
			let result = `'${parameter.name}', ${parameter.type}`;
			
			if (parameter.mandatory === undefined || parameter.mandatory === true)
				result += ', true';
			else if (parameter.argTypeDetails || parameter.bCanFail === true) {
				result += ', false';
			}

			if (parameter.argTypeDetails) {
				result += ', ';
				writer.stringify(parameter.argTypeDetails, true);
			}
			else if (parameter.bCanFail === true) {
				result += ', array()';
			}

			if (parameter.bCanFail === true) {
				result += ', true';
			}
			return result;
		};
		fs.writeFileSync(`${yourgamename}.action.php`,
`<?php
${writer.fileSignature}
class action_${yourgamename} extends APP_GameAction
{
	/** @var ${yourgamename} $game */
	protected $game; // Enforces functions exist on Table class

	// Constructor: please do not modify
	public function __default()
	{
		if (self::isArg('notifwindow')) {
			$this->view = "common_notifwindow";
			$this->viewArgs['table'] = self::getArg("table", AT_posint, true);
		} else {
			$this->view = "${yourgamename}_${yourgamename}";
			self::trace("Complete reinitialization of board game");
		}
	}${Array.from(possibleActions).map(([name, parameters]) => `

	public function ${name}()
	{
		self::setAjaxMode();
${parameters.map(parameter => `
		/** @var ${pType(parameter)} $${parameter.name} */
		$${parameter.name} = self::getArg(${pArgs(parameter)});`
).join('')}${parameters.length > 0 ? '\n' : ''}
		$this->game->${name}( ${parameters.map(x => "$" + x.name).join(', ')} );
		self::ajaxResponse();
	}`).join('')}
}`);
		// #endregion
	});
}
//#endregion

//#region JSONC->JSON
{
	const jsoncToJson = (message, source, target) => {
		if (!fs.existsSync(source)) {
			return;
		}
		builder.watchCommand(message, source, () => fs.writeFileSync(target, jsoncUtil.stringToJson(fs.readFileSync(source, 'utf8'))));
	};

	if (fs.existsSync(path.join(sourceFolder, 'shared','stats.jsonc')))
		jsoncToJson("Game Statistics: stats.jsonc => stats.json", path.join(sourceFolder, 'shared','stats.jsonc'), 'stats.json');
	if (fs.existsSync(path.join(sourceFolder, 'shared','gameoptions.jsonc')))
		jsoncToJson("Game Options: gameoptions.jsonc => gameoptions.json", path.join(sourceFolder, 'shared','gameoptions.jsonc'), 'gameoptions.json');
	if (fs.existsSync(path.join(sourceFolder, 'shared','gamepreferences.jsonc')))
		jsoncToJson("Game Preferences: gamepreferences.jsonc => gamepreferences.json", path.join(sourceFolder, 'shared','gamepreferences.jsonc'), 'gamepreferences.json');
}
//#endregion

//#region Game Infos
if (fs.existsSync(path.join(sourceFolder, 'shared/gameinfos.jsonc')))
{
	builder.watchCommand("Game Infos: gameinfos.jsonc => gameinfos.inc.php", path.join(sourceFolder, 'shared/gameinfos.jsonc'), () => {
		const gameinfos = jsoncUtil.readObject(path.join(sourceFolder, 'shared/gameinfos.jsonc'));
		fs.writeFileSync('gameinfos.inc.php',
`<?php
${writer.fileSignature}
/** @var (string|int|null|bool|string[]|int[])[] $gameinfos */
$gameinfos = ${writer.stringify(gameinfos, true)};`);
	});
}
//#endregion

//#region Compilers

if (fs.existsSync(path.join(sourceFolder, 'client/tsconfig.json'))){

	const tsCommand = `npx tsc -p "${path.join(sourceFolder, 'client')}" --outFile ${yourgamename}.js` + (builder.watch ? ' -w' : '');
	builder.execCommand(`Typescript compiler: client/define.ts => ${yourgamename}.js`, tsCommand);

	// const cookbookModuleRegex = /"@cookbook\/([^"]+)"/g;
	// const searchString = `define("${yourgamename}", [`; 
	// const importFixer = () => {
	// 	if (!fs.existsSync(`${yourgamename}.js`))
	// 		return;

	// 	const data = fs.readFileSync(`${yourgamename}.js`, 'utf8');
	// 	const start = data.indexOf(searchString);
	// 	if (start !== -1) {
	// 		const end = start + searchString.length;
	// 		const result = data.substring(0, start) + 'define([' + data.substring(end);
	// 		fs.writeFileSync(`${yourgamename}.js`, result, 'utf8');

	// 		// now, parse the array of strings in the define function to see if we need to add any imports to the imports.d.ts file. We already have the index of where the array starts. If there are no matches, delete the imports.d.ts file.
	// 		const array = data.substring(end, data.indexOf('],', end));
	// 		const imports = Array.from(array.matchAll(cookbookModuleRegex), m => m[1]);
	// 		const importsPath = path.join(sourceFolder, 'client','build','imports.d.ts');
	// 		if (imports.length === 0) {
	// 			if (fs.existsSync(importsPath)) {
	// 				fs.unlinkSync(importsPath);
	// 				if (!builder.watch) {
	// 					builder.execSync(tsCommand);
	// 					importFixer();
	// 				}
	// 			}
	// 			return;
	// 		}

	// 		const importsContent = writer.fileSignature + imports.map(importName => `\n/// <reference path="${path.join('..', '..', sourceToTemplate, 'typescript', 'cookbook', `${importName}.ts`)}" />`).join('');

	// 		if (!fs.existsSync(importsPath) || fs.readFileSync(importsPath, 'utf8') !== importsContent) {
	// 			if (!fs.existsSync(path.join(sourceFolder, 'client','build')))
	// 				fs.mkdirSync(path.join(sourceFolder, 'client','build'), { recursive: true });

	// 			fs.writeFileSync(importsPath, importsContent, 'utf8');

	// 			if (!builder.watch) {
	// 				builder.execSync(tsCommand);
	// 				importFixer();
	// 			}
	// 		}
	// 	}
	// };

	// builder.watchCommand(`Import Generator: ${path.join(sourceFolder, 'client/build/imports.d.ts')}`, `${yourgamename}.js`, importFixer);
}

if (fs.existsSync(path.join(sourceFolder, `client/${yourgamename}.scss`))) {
	builder.execCommand(`SCSS compiler: client/${yourgamename}.scss => ${yourgamename}.css`, 
		`npx sass --no-source-map ${path.join(sourceFolder, `client/${yourgamename}.scss`)} ${yourgamename}.css` + (builder.watch ? ' --watch' : ''));
}

//#endregion


// #region Run!

console.log('Running build commands:');
for (const command of builder.commands) {
	if (command.message)
		console.log("\t" + command.message);
	command.callback();
}

if (!builder.watch)
	console.log('Build complete.');
else {
	setTimeout(() => {
		console.log('Press Ctrl+C to stop watching. Watching for changes...');
	}, 1000);
}