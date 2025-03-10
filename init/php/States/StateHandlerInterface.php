<?php
namespace Bga\Games\___YourGameName___\States;

use Bga\Games\___YourGameName___\Game;

interface StateHandlerInterface {
    public static function handle(Game $game, string $action, ...$args): void;
    public static function executeGameState(Game $game): void;
}