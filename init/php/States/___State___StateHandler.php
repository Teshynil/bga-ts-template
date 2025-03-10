<?php

namespace Bga\Games\___YourGameName___\States;

use Bga\Games\___YourGameName___\Game;
use BgaUserException;
use BgaVisibleSystemException;

class ___State___StateHandler implements StateHandlerInterface
{
    public static function handle(Game $game, string $action, ...$args): void
    {
        switch ($action) {
            case 'selectLeader':
                self::selectLeader($game, ...$args);
                break;
            default:
                throw new BgaVisibleSystemException("Invalid action: $action");
        }
    }

    private static function selectLeader(Game $game, int $leaderId): void {}

    public static function executeGameState(Game $game): void {}
}
