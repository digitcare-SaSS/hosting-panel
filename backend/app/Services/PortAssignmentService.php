<?php

namespace App\Services;

use App\Models\App;

class PortAssignmentService
{
    public function assignPort(): int
    {
        $start = (int) config('hosting.port_range_start', 3000);
        $end   = (int) config('hosting.port_range_end', 9999);

        // Collect ports already used by existing apps
        $usedPorts = array_merge(
            App::whereNotNull('port')->pluck('port')->toArray(),
            App::whereNotNull('standby_port')->pluck('standby_port')->toArray(),
        );

        for ($port = $start; $port <= $end; $port++) {
            if (in_array($port, $usedPorts)) {
                continue;
            }
            // Also check if port is actually in use on the system
            if (!$this->isPortInUse($port)) {
                return $port;
            }
        }

        throw new \RuntimeException("No available ports in range {$start}-{$end}");
    }

    private function isPortInUse(int $port): bool
    {
        $connection = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.1);
        if ($connection) {
            fclose($connection);
            return true;
        }
        return false;
    }
}
