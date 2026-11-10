import * as React from 'react';
import { Space } from '../api';
import '../styles/SpaceSwitcher';


export interface SpaceSwitcherProps {
  current?: string;
  onSelect: (space: string) => void;
  spaces: Space[];
}

// Выпадающий список пространств в шапке; при одном пространстве переключать нечего
export class SpaceSwitcher extends React.Component<SpaceSwitcherProps> {
  render () {
    if (this.props.spaces.length < 2) {
      return null;
    }
    const options = this.props.spaces.map(space => (
      <option key={space.name} value={space.name}>{space.title || space.name}</option>
    ));
    return (
      <label className='space-switcher'>
        <span className='space-switcher-label'>Пространство</span>
        <select className='space-select' value={this.props.current || ''}
                onChange={this.handleChange}>
          {options}
        </select>
      </label>
    );
  }

  private handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.props.onSelect(event.currentTarget.value);
  };
}
