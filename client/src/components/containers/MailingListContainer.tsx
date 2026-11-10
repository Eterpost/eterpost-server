import { connect } from 'react-redux';
import { MailingList, MailingListProps } from '../MailingList';
import { RootState } from '../../reducers/index';
import { selectMailing } from '../../actions/selectMailing';
import { Mailing } from '../../reducers/mailings';
import { showAddForm } from '../../actions/showAddForm';
import { AppDispatch } from '../../types';
import { MailingKind } from '../../api';
import { selectMailingKind } from '../../actions/loadSpaces';


function mapStateToProps (state: RootState) {
  return {
    kind: state.ui.kind,
    loaded: state.mailings.loaded,
    mailings: state.mailings.ids.map(id => state.mailings.byId[id]),
    noSpaces: Boolean(state.ui.spaces && !state.ui.spaces.length),
    selectedMailing: state.mailings.selected
  };
}

function mapDispatchToProps (dispatch: AppDispatch) {
  return {
    onSelect (mailing: Mailing): void {
      dispatch(selectMailing(mailing.id));
    },
    onSelectKind (kind: MailingKind) {
      dispatch(selectMailingKind(kind));
    },
    onShowAddForm () {
      dispatch(showAddForm());
    }
  };
}

export const MailingListContainer = connect<MailingListProps>(
  mapStateToProps, mapDispatchToProps
)(MailingList);
