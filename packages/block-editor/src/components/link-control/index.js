/**
 * External dependencies
 */
import classnames from 'classnames';
import { noop, startsWith } from 'lodash';

/**
 * WordPress dependencies
 */
import {
	Button,
	ExternalLink,
	Spinner,
	VisuallyHidden,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import {
	useRef,
	useCallback,
	useState,
	Fragment,
	useEffect,
} from '@wordpress/element';
import {
	cleanForSlug,
	safeDecodeURI,
	filterURLForDisplay,
	isURL,
	prependHTTP,
	getProtocol,
} from '@wordpress/url';
import { useInstanceId } from '@wordpress/compose';
import { useSelect } from '@wordpress/data';
import { focus } from '@wordpress/dom';

/**
 * Internal dependencies
 */
import LinkControlSettingsDrawer from './settings-drawer';
import LinkControlSearchItem from './search-item';
import LinkControlSearchInput from './search-input';
import LinkControlSearchCreate from './search-create-button';
const CREATE_TYPE = '__CREATE__';

/**
 * Creates a wrapper around a promise which allows it to be programmatically
 * cancelled.
 * See: https://reactjs.org/blog/2015/12/16/ismounted-antipattern.html
 *
 * @param {Promise} promise the Promise to make cancelable
 */
const makeCancelable = ( promise ) => {
	let hasCanceled_ = false;

	const wrappedPromise = new Promise( ( resolve, reject ) => {
		promise.then(
			( val ) =>
				hasCanceled_ ? reject( { isCanceled: true } ) : resolve( val ),
			( error ) =>
				hasCanceled_ ? reject( { isCanceled: true } ) : reject( error )
		);
	} );

	return {
		promise: wrappedPromise,
		cancel() {
			hasCanceled_ = true;
		},
	};
};
/**
 * Default properties associated with a link control value.
 *
 * @typedef WPLinkControlDefaultValue
 *
 * @property {string}   url           Link URL.
 * @property {string=}  title         Link title.
 * @property {boolean=} opensInNewTab Whether link should open in a new browser
 *                                    tab. This value is only assigned if not
 *                                    providing a custom `settings` prop.
 */

/**
 * Custom settings values associated with a link.
 *
 * @typedef {{[setting:string]:any}} WPLinkControlSettingsValue
 */

/**
 * Custom settings values associated with a link.
 *
 * @typedef WPLinkControlSetting
 *
 * @property {string} id    Identifier to use as property for setting value.
 * @property {string} title Human-readable label to show in user interface.
 */

/**
 * Properties associated with a link control value, composed as a union of the
 * default properties and any custom settings values.
 *
 * @typedef {WPLinkControlDefaultValue&WPLinkControlSettingsValue} WPLinkControlValue
 */

/** @typedef {(nextValue:WPLinkControlValue)=>void} WPLinkControlOnChangeProp */

/**
 * @typedef WPLinkControlProps
 *
 * @property {(WPLinkControlSetting[])=}                         settings               An array of settings objects. Each object will used to
 *                                                                                      render a `ToggleControl` for that setting.
 * @property {(search:string)=>Promise=}                         fetchSearchSuggestions Fetches suggestions for a given search term,
 *                                                                                      returning a promise resolving once fetch is complete.
 * @property {WPLinkControlValue=}                               value                  Current link value.
 * @property {WPLinkControlOnChangeProp=}                        onChange               Value change handler, called with the updated value if
 *                                                                                      the user selects a new link or updates settings.
 * @property {boolean=}                                          showInitialSuggestions Whether to present initial suggestions immediately.
 * @property {(title:string)=>WPLinkControlValue=}               createSuggestion       Handler to manage creation of link value from suggestion.
 */

/**
 * Renders a link control. A link control is a controlled input which maintains
 * a value associated with a link (HTML anchor element) and relevant settings
 * for how that link is expected to behave.
 *
 * @param {WPLinkControlProps} props Component props.
 */
function LinkControl( {
	value,
	settings,
	onChange = noop,
	showInitialSuggestions,
	createSuggestion,
} ) {
	let cancelableOnCreate;
	let cancelableCreateSuggestion;

	const wrapperNode = useRef();
	const instanceId = useInstanceId( LinkControl );
	const [ inputValue, setInputValue ] = useState(
		( value && value.url ) || ''
	);
	const [ isEditingLink, setIsEditingLink ] = useState(
		! value || ! value.url
	);
	const [ isResolvingLink, setIsResolvingLink ] = useState( false );
	const [ errorMessage, setErrorMessage ] = useState( null );
	const isEndingEditWithFocus = useRef( false );

	const { fetchSearchSuggestions } = useSelect( ( select ) => {
		const { getSettings } = select( 'core/block-editor' );
		return {
			fetchSearchSuggestions: getSettings()
				.__experimentalFetchLinkSuggestions,
		};
	}, [] );
	const displayURL =
		( value && filterURLForDisplay( safeDecodeURI( value.url ) ) ) || '';

	useEffect( () => {
		// When `isEditingLink` is set to `false`, a focus loss could occur
		// since the link input may be removed from the DOM. To avoid this,
		// reinstate focus to a suitable target if focus has in-fact been lost.
		// Note that the check is necessary because while typically unsetting
		// edit mode would render the read-only mode's link element, it isn't
		// guaranteed. The link input may continue to be shown if the next value
		// is still unassigned after calling `onChange`.
		const hadFocusLoss =
			isEndingEditWithFocus.current &&
			wrapperNode.current &&
			! wrapperNode.current.contains( document.activeElement );

		if ( hadFocusLoss ) {
			// Prefer to focus a natural focusable descendent of the wrapper,
			// but settle for the wrapper if there are no other options.
			const nextFocusTarget =
				focus.focusable.find( wrapperNode.current )[ 0 ] ||
				wrapperNode.current;

			nextFocusTarget.focus();
		}

		isEndingEditWithFocus.current = false;
	}, [ isEditingLink ] );

	/**
	 * Handles cancelling any pending Promises that have been made cancelable.
	 */
	useEffect( () => {
		return () => {
			// componentDidUnmount
			if ( cancelableOnCreate ) {
				cancelableOnCreate.cancel();
			}
			if ( cancelableCreateSuggestion ) {
				cancelableCreateSuggestion.cancel();
			}
		};
	}, [] );

	/**
	 * onChange LinkControlSearchInput event handler
	 *
	 * @param {string} val Current value returned by the search.
	 */
	const onInputChange = ( val = '' ) => {
		setErrorMessage( null ); // remove lingering error messages
		setInputValue( val );
	};

	const resetInput = () => {
		setErrorMessage( null ); // remove lingering error messages
		setInputValue( '' );
	};

	const handleDirectEntry = ( val ) => {
		let type = 'URL';

		const protocol = getProtocol( val ) || '';

		if ( protocol.includes( 'mailto' ) ) {
			type = 'mailto';
		}

		if ( protocol.includes( 'tel' ) ) {
			type = 'tel';
		}

		if ( startsWith( val, '#' ) ) {
			type = 'internal';
		}

		return Promise.resolve( [
			{
				id: cleanForSlug( val ),
				title: val,
				url: type === 'URL' ? prependHTTP( val ) : val,
				type,
			},
		] );
	};

	const handleEntitySearch = async ( val, args ) => {
		let results = await Promise.all( [
			fetchSearchSuggestions( val, {
				...( args.isInitialSuggestions ? { perPage: 3 } : {} ),
			} ),
			handleDirectEntry( val ),
		] );

		const couldBeURL = ! val.includes( ' ' );

		// If it's potentially a URL search then concat on a URL search suggestion
		// just for good measure. That way once the actual results run out we always
		// have a URL option to fallback on.
		results =
			couldBeURL && ! args.isInitialSuggestions
				? results[ 0 ].concat( results[ 1 ] )
				: results[ 0 ];

		// Here we append a faux suggestion to represent a "CREATE" option. This
		// is detected in the rendering of the search results and handeled as a
		// special case. This is currently necessary because the suggestions
		// dropdown will only appear if there are valid suggestions and
		// therefore unless the create option is a suggestion it will not
		// display in scenarios where there are no results returned from the
		// API. In addition promoting CREATE to a first class suggestion affords
		// the a11y benefits afforded by `URLInput` to all suggestions (eg:
		// keyboard handling, ARIA roles...etc).
		//
		// Note also that the value of the `title` and `url` properties must correspond
		// to the text value of the `<input>`. This is because `title` is used
		// when creating the entity. Similarly `url` is used when using keyboard to select
		// the suggestion (the <form> `onSubmit` handler falls-back to `url`).
		return maybeURL( val )
			? results
			: results.concat( {
					id: cleanForSlug( val ),
					title: val, // must match the existing `<input>`s text value
					url: val, // must match the existing `<input>`s text value
					type: CREATE_TYPE,
			  } );
	};

	/**
	 * Determines which type of search handler to use based on the users input.
	 * Cancels editing state and marks that focus may need to be restored after
	 * the next render, if focus was within the wrapper when editing finished.
	 * else a API search should made for matching Entities.
	 */
	function stopEditing() {
		isEndingEditWithFocus.current =
			!! wrapperNode.current &&
			wrapperNode.current.contains( document.activeElement );

		setIsEditingLink( false );
	}

	/**
	 * Determines whether a given value could be a URL. Note this does not
	 * guarantee the value is a URL only that it looks like it might be one
	 * (thus the naming of the method).
	 *
	 * @param {string} val the candidate for being a valid URL (or not).
	 */
	function maybeURL( val ) {
		const isInternal = startsWith( val, '#' );

		return isInternal || isURL( val ) || ( val && val.includes( 'www.' ) );
	}

	// Effects
	const getSearchHandler = useCallback(
		( val, args ) => {
			return maybeURL( val )
				? handleDirectEntry( val, args )
				: handleEntitySearch( val, args );
		},
		[ handleDirectEntry, fetchSearchSuggestions ]
	);

	const handleOnCreate = async ( suggestionTitle ) => {
		let newSuggestion;

		setIsResolvingLink( true );
		setErrorMessage( null );

		try {
			// Make cancellable in order that we can avoid setting State
			// if the component unmounts during the call to `createSuggestion`
			cancelableCreateSuggestion = makeCancelable(
				createSuggestion( suggestionTitle )
			);
			newSuggestion = await cancelableCreateSuggestion.promise;
		} catch ( error ) {
			if ( error.isCanceled ) {
				return; // bail out of state updates if the promise was cancelled
			}
			setErrorMessage(
				error.msg ||
					__(
						'An unknown error occurred during creation. Please try again.'
					)
			);
		}

		setIsResolvingLink( false );

		// Only set link if request is resolved, otherwise enable edit mode.
		if ( newSuggestion ) {
			onChange( newSuggestion );
		} else {
			setIsEditingLink( true );
		}
	};

	const handleSelectSuggestion = ( suggestion, _value = {} ) => {
		setIsEditingLink( false );
		onChange( { ..._value, ...suggestion } );
	};

	// Render Components
	const renderSearchResults = ( {
		suggestionsListProps,
		buildSuggestionItemProps,
		suggestions,
		selectedSuggestion,
		isLoading,
		isInitialSuggestions,
	} ) => {
		const resultsListClasses = classnames(
			'block-editor-link-control__search-results',
			{
				'is-loading': isLoading,
			}
		);

		const directLinkEntryTypes = [ 'url', 'mailto', 'tel', 'internal' ];
		const isSingleDirectEntryResult =
			suggestions.length === 1 &&
			directLinkEntryTypes.includes(
				suggestions[ 0 ].type.toLowerCase()
			);
		const shouldShowCreateEntity =
			createSuggestion &&
			! isSingleDirectEntryResult &&
			! isInitialSuggestions;

		// According to guidelines aria-label should be added if the label
		// itself is not visible.
		// See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/listbox_role
		const searchResultsLabelId = isInitialSuggestions
			? `block-editor-link-control-search-results-label-${ instanceId }`
			: undefined;
		const labelText = isInitialSuggestions
			? __( 'Recently updated' )
			: sprintf( __( 'Search results for %s' ), inputValue );
		const ariaLabel = isInitialSuggestions ? undefined : labelText;
		const searchResultsLabel = (
			<span
				className="block-editor-link-control__search-results-label"
				id={ searchResultsLabelId }
				aria-label={ ariaLabel }
			>
				{ labelText }
			</span>
		);

		return (
			<div className="block-editor-link-control__search-results-wrapper">
				{ isInitialSuggestions && searchResultsLabel }
				<div
					{ ...suggestionsListProps }
					className={ resultsListClasses }
					aria-label={ ariaLabel } // will only be present if there is no visible label
					aria-labelledby={ searchResultsLabelId } // references the visible label, if there is one
				>
					{ suggestions.map( ( suggestion, index ) => {
						if (
							shouldShowCreateEntity &&
							CREATE_TYPE === suggestion.type
						) {
							return (
								<LinkControlSearchCreate
									searchTerm={ inputValue }
									onClick={ async () => {
										try {
											cancelableOnCreate = makeCancelable(
												handleOnCreate(
													suggestion.title
												)
											);

											await cancelableOnCreate.promise;
										} catch ( error ) {
											if ( error && error.isCanceled ) {
												return; // bail if canceled to avoid setting state
											}
										}

										// Only setState if not cancelled
										stopEditing();
									} }
									key={ `${ suggestion.id }-${ suggestion.type }` }
									itemProps={ buildSuggestionItemProps(
										suggestion,
										index
									) }
									isSelected={ index === selectedSuggestion }
								/>
							);
						}

						// If we're not handling "Create" suggestions above then
						// we don't want them in the main results so exit early
						if ( CREATE_TYPE === suggestion.type ) {
							return null;
						}

						return (
							<LinkControlSearchItem
								key={ `${ suggestion.id }-${ suggestion.type }` }
								itemProps={ buildSuggestionItemProps(
									suggestion,
									index
								) }
								suggestion={ suggestion }
								onClick={ () => {
									stopEditing();
									onChange( { ...value, ...suggestion } );
								} }
								isSelected={ index === selectedSuggestion }
								isURL={ directLinkEntryTypes.includes(
									suggestion.type.toLowerCase()
								) }
								searchTerm={ inputValue }
							/>
						);
					} ) }
				</div>
			</div>
		);
	};

	return (
		<div
			tabIndex={ -1 }
			ref={ wrapperNode }
			className="block-editor-link-control"
		>
			{ isResolvingLink && (
				<div className="block-editor-link-control__loading">
					<Spinner /> { __( 'Creating' ) }…
				</div>
			) }

			{ ( isEditingLink || ! value ) && ! isResolvingLink && (
				<LinkControlSearchInput
					value={ inputValue }
					onChange={ onInputChange }
					onSelect={ async ( suggestion ) => {
						if (
							suggestion.type &&
							CREATE_TYPE === suggestion.type
						) {
							try {
								cancelableOnCreate = makeCancelable(
									handleOnCreate( inputValue )
								);

								await cancelableOnCreate.promise;
							} catch ( error ) {
								if ( error && error.isCanceled ) {
									return; // bail if canceled to avoid setting state
								}
							}
						} else {
							handleSelectSuggestion( suggestion, value );
						}

						// Must be called after handling to ensure focus is
						// managed correctly.
						stopEditing();
					} }
					renderSuggestions={ renderSearchResults }
					fetchSuggestions={ getSearchHandler }
					onReset={ resetInput }
					showInitialSuggestions={ showInitialSuggestions }
					errorMessage={ errorMessage }
				/>
			) }

			{ value && ! isEditingLink && ! isResolvingLink && (
				<Fragment>
					<VisuallyHidden>
						<p id={ `current-link-label-${ instanceId }` }>
							{ __( 'Currently selected' ) }:
						</p>
					</VisuallyHidden>
					<div
						aria-label={ __( 'Currently selected' ) }
						aria-selected="true"
						className={ classnames(
							'block-editor-link-control__search-item',
							{
								'is-current': true,
							}
						) }
					>
						<span className="block-editor-link-control__search-item-header">
							<ExternalLink
								className="block-editor-link-control__search-item-title"
								href={ value.url }
							>
								{ ( value && value.title ) || displayURL }
							</ExternalLink>
							{ value && value.title && (
								<span className="block-editor-link-control__search-item-info">
									{ displayURL }
								</span>
							) }
						</span>

						<Button
							isSecondary
							onClick={ () => setIsEditingLink( true ) }
							className="block-editor-link-control__search-item-action"
						>
							{ __( 'Edit' ) }
						</Button>
					</div>
					<LinkControlSettingsDrawer
						value={ value }
						settings={ settings }
						onChange={ onChange }
					/>
				</Fragment>
			) }
		</div>
	);
}

export default LinkControl;
