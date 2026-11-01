<?php

declare(strict_types=1);

namespace App\Concerns;

use Illuminate\Database\Eloquent\Model;

trait ClonesModelData
{
    protected function cloneModelData(Model $model): Model
    {
        $data = $model->getAttributes();

        unset(
            $data[$model->getKeyName()],
            $data['created_at'],
            $data['updated_at'],
            $data['deleted_at'],
        );

        $class = $model::class;

        return new $class($data);
    }
}
