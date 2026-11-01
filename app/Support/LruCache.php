<?php

declare(strict_types=1);

namespace App\Support;

/**
 * * Fixed-capacity LRU cache: keeps memory flat for long-running workers touching many keys.
 * * Relies on PHP arrays keeping insertion order — a hit re-inserts the key at the end.
 */
class LruCache
{
    /** @var array<string, mixed> */
    private array $store = [];

    public function __construct(private readonly int $capacity = 64) {}

    public function get(string $key, callable $resolver): mixed
    {
        if (array_key_exists($key, $this->store)) {
            $value = $this->store[$key];
            $this->touch($key, $value);

            return $value;
        }

        $value = $resolver();
        $this->put($key, $value);

        return $value;
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->store);
    }

    public function put(string $key, mixed $value): void
    {
        if (array_key_exists($key, $this->store)) {
            $this->touch($key, $value);

            return;
        }

        if (count($this->store) >= $this->capacity) {
            // * The first entry is the least recently used one.
            array_shift($this->store);
        }

        $this->store[$key] = $value;
    }

    public function count(): int
    {
        return count($this->store);
    }

    public function forget(string $key): void
    {
        unset($this->store[$key]);
    }

    public function flush(): void
    {
        $this->store = [];
    }

    private function touch(string $key, mixed $value): void
    {
        unset($this->store[$key]);
        $this->store[$key] = $value;
    }
}
